import "dotenv/config";
import { ethers } from "ethers";

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function toLower(addr) {
  return String(addr).toLowerCase();
}

function hexlify(value) {
  return ethers.toBeHex(value);
}

function packUint128Pair(high, low) {
  const hi = ethers.zeroPadValue(ethers.toBeHex(high), 16);
  const lo = ethers.zeroPadValue(ethers.toBeHex(low), 16);
  return ethers.hexlify(ethers.concat([hi, lo]));
}

function packInitCode(factory, factoryData) {
  return ethers.hexlify(ethers.concat([ethers.getBytes(factory), ethers.getBytes(factoryData)]));
}

function packPaymasterAndData(paymaster, paymasterVerificationGasLimit, paymasterPostOpGasLimit, paymasterData) {
  const pm = ethers.getBytes(paymaster);
  const vgl = ethers.zeroPadValue(ethers.toBeHex(paymasterVerificationGasLimit), 16);
  const pgl = ethers.zeroPadValue(ethers.toBeHex(paymasterPostOpGasLimit), 16);
  const data = ethers.getBytes(paymasterData);
  return ethers.hexlify(ethers.concat([pm, vgl, pgl, data]));
}

async function getNonce(publicRpc, entryPoint, sender) {
  const entryPointAbi = ["function getNonce(address sender, uint192 key) view returns (uint256)"];
  const ep = new ethers.Contract(entryPoint, entryPointAbi, publicRpc);
  return await ep.getNonce(sender, 0);
}

async function getUserOpHash(publicRpc, entryPoint, packedUserOp) {
  const entryPointAbi = [
    "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  ];
  const ep = new ethers.Contract(entryPoint, entryPointAbi, publicRpc);
  return await ep.getUserOpHash(packedUserOp);
}

function ceilDiv(a, b) {
  if (a === 0n) return 0n;
  return (a + b - 1n) / b;
}

async function main() {
  const rpcUrl = requireEnv("RPC_URL");
  const bundlerUrl = requireEnv("BUNDLER_URL");
  const chainId = Number(requireEnv("CHAIN_ID"));

  const entryPoint = requireEnv("ENTRYPOINT");
  const paymasterAddr = requireEnv("PAYMASTER");
  const routerAddr = requireEnv("ROUTER");
  const factoryAddr = requireEnv("FACTORY");
  const permit2Address = requireEnv("PERMIT2");

  const ownerEoa = requireEnv("OWNER_EOA");
  const token = requireEnv("TOKEN");
  const to = requireEnv("TO");
  const amount = BigInt(requireEnv("AMOUNT"));

  const pk =
    process.env.PRIVATE_KEY_OWNER ||
    process.env.PRIVATE_KEY_TEST_USER ||
    process.env.PRIVATE_KEY_DEPLOYER ||
    "";
  if (!pk || !pk.startsWith("0x") || pk.length < 66) {
    throw new Error("Missing PRIVATE_KEY_OWNER or PRIVATE_KEY_TEST_USER in .env");
  }

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);
  const wallet = new ethers.Wallet(pk, publicRpc);

  if (toLower(wallet.address) !== toLower(ownerEoa)) {
    throw new Error(`OWNER_EOA mismatch. env=${ownerEoa} wallet=${wallet.address}`);
  }

  const factoryAbi = [
    "function getAddress(address owner, uint256 salt) view returns (address)",
    "function createAccount(address owner, uint256 salt) returns (address)",
  ];
  const factory = new ethers.Contract(factoryAddr, factoryAbi, publicRpc);
  const salt = 0n;
  const sender = await factory["getAddress(address,uint256)"](ownerEoa, salt);

  const senderCode = await publicRpc.getCode(sender);
  const senderDeployed = typeof senderCode === "string" && senderCode !== "0x";
  const factoryData = factory.interface.encodeFunctionData("createAccount", [ownerEoa, salt]);

  const permit2Abi = [
    "function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)",
    "function permit(address owner,((address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline) permitSingle,bytes signature)",
  ];
  const permit2 = new ethers.Contract(permit2Address, permit2Abi, publicRpc);
  const [_, __, currentNonce] = await permit2.allowance(ownerEoa, token, routerAddr);

  const now = Math.floor(Date.now() / 1000);
  const permitExpiration = BigInt(now + 60 * 60 * 24 * 30);
  const sigDeadline = BigInt(now + 60 * 30);

  const typedData = {
    domain: {
      name: "Permit2",
      chainId,
      verifyingContract: permit2Address,
    },
    types: {
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
    },
    primaryType: "PermitSingle",
    message: {
      details: {
        token,
        amount: BigInt(amount),
        expiration: permitExpiration,
        nonce: BigInt(currentNonce),
      },
      spender: routerAddr,
      sigDeadline,
    },
  };

  const signature = await wallet.signTypedData(typedData.domain, typedData.types, typedData.message);

  const permitSingle = {
    details: {
      token: typedData.message.details.token,
      amount: BigInt(typedData.message.details.amount),
      expiration: BigInt(typedData.message.details.expiration),
      nonce: BigInt(typedData.message.details.nonce),
    },
    spender: typedData.message.spender,
    sigDeadline: BigInt(typedData.message.sigDeadline),
  };

  const routerAbi = [
    "function sendERC20Permit2Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee,address owner)",
  ];
  const router = new ethers.Contract(routerAddr, routerAbi, publicRpc);

  const paymasterAbi = [
    "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256 baselineUsd6,uint256 surchargeUsd6,uint256 finalFeeUsd6,uint256 capBpsValue,uint256 maxFeeRequiredUsd6,bool firstTxSurchargeApplies)",
    "function feeTokenDecimals(address) view returns (uint8)",
    "function usd6PerWholeToken(address) view returns (uint256)",
  ];
  const paymaster = new ethers.Contract(paymasterAddr, paymasterAbi, publicRpc);

  const feeToken = token;
  const nowTs = Math.floor(Date.now() / 1000);
  const quote = await paymaster.quoteFeeUsd6(sender, 0, 0, nowTs);
  const totalUsd6 = BigInt(quote.finalFeeUsd6);
  const maxFeeUsd6 = BigInt(quote.maxFeeRequiredUsd6);
  const decimals = BigInt(await paymaster.feeTokenDecimals(feeToken));
  const price = BigInt(await paymaster.usd6PerWholeToken(feeToken));
  const finalFeeToken = ceilDiv(totalUsd6 * 10n ** decimals, price);

  const permitCallData = permit2.interface.encodeFunctionData("permit", [ownerEoa, permitSingle, signature]);
  const routerCallData = router.interface.encodeFunctionData("sendERC20Permit2Sponsored", [
    ownerEoa,
    token,
    to,
    amount,
    feeToken,
    finalFeeToken,
    ownerEoa,
  ]);

  try {
    await permit2.getFunction("permit").staticCall(ownerEoa, permitSingle, signature, { from: ownerEoa });
    console.log("PERMIT2_STATICCALL_OK");
  } catch (err) {
    console.error("PERMIT2_STATICCALL_FAIL", err);
    process.exit(1);
  }

  const accountAbi = [
    "function execute(address dest,uint256 value,bytes func)",
    "function executeBatch(address[] dest,uint256[] value,bytes[] func)",
  ];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("executeBatch", [
    [permit2Address, routerAddr],
    [0n, 0n],
    [permitCallData, routerCallData],
  ]);

  const gasDefaults = {
    callGasLimit: 500_000n,
    verificationGasLimit: 300_000n,
    preVerificationGas: 100_000n,
    paymasterVerificationGasLimit: 200_000n,
    paymasterPostOpGasLimit: 200_000n,
  };

  const gasPriceResp = await bundlerRpc.send("pimlico_getUserOperationGasPrice", []);
  const pick = gasPriceResp?.standard ?? gasPriceResp?.fast ?? gasPriceResp?.slow;
  if (!pick?.maxFeePerGas || !pick?.maxPriorityFeePerGas) {
    throw new Error(`Invalid gas price response: ${JSON.stringify(gasPriceResp)}`);
  }

  const paymasterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    [0, 0, feeToken, maxFeeUsd6, BigInt(nowTs + 3600), BigInt(nowTs - 60)]
  );

  const userOpNonce = await getNonce(publicRpc, entryPoint, sender);

  const userOp = {
    sender,
    nonce: hexlify(userOpNonce),
    ...(senderDeployed ? {} : { factory: factoryAddr, factoryData }),
    callData,
    callGasLimit: hexlify(gasDefaults.callGasLimit),
    verificationGasLimit: hexlify(gasDefaults.verificationGasLimit),
    preVerificationGas: hexlify(gasDefaults.preVerificationGas),
    maxFeePerGas: pick.maxFeePerGas,
    maxPriorityFeePerGas: pick.maxPriorityFeePerGas,
    paymaster: paymasterAddr,
    paymasterVerificationGasLimit: hexlify(gasDefaults.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: hexlify(gasDefaults.paymasterPostOpGasLimit),
    paymasterData,
    signature: "0x",
  };

  const initCode = senderDeployed ? "0x" : packInitCode(factoryAddr, factoryData);
  const accountGasLimits = packUint128Pair(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
  const gasFees = packUint128Pair(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
  const paymasterAndData = packPaymasterAndData(
    paymasterAddr,
    BigInt(userOp.paymasterVerificationGasLimit),
    BigInt(userOp.paymasterPostOpGasLimit),
    paymasterData
  );

  const packedUserOp = {
    sender,
    nonce: userOpNonce,
    initCode,
    callData,
    accountGasLimits,
    preVerificationGas: BigInt(userOp.preVerificationGas),
    gasFees,
    paymasterAndData,
    signature: "0x",
  };

  const userOpHash = await getUserOpHash(publicRpc, entryPoint, packedUserOp);
  userOp.signature = wallet.signingKey.sign(userOpHash).serialized;

  try {
    const sim = await bundlerRpc.send("eth_simulateUserOperation", [userOp, entryPoint]);
    console.log("SIMULATE_USEROP", sim);
  } catch (err) {
    console.log("SIMULATE_USEROP_UNSUPPORTED_OR_FAILED", err?.shortMessage || err?.message || err);
  }

  const gas = await bundlerRpc.send("eth_estimateUserOperationGas", [userOp, entryPoint]);
  console.log("SIMULATION_OK");
  console.log(`USEROP_HASH=${userOpHash}`);
  console.log(`FINAL_FEE_TOKEN=${finalFeeToken}`);
  console.log(`MAX_FEE_USD6=${maxFeeUsd6}`);
  console.log("GAS_ESTIMATE", gas);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});