import "dotenv/config";
import { ethers } from "ethers";

function hexlify(value) {
  return ethers.toBeHex(value);
}

function isHexString(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && v.length >= 2;
}

function toLower(addr) {
  return String(addr).toLowerCase();
}

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function requirePrivateKey(name) {
  const pk = requireEnv(name);
  if (!pk.startsWith("0x") || pk.length !== 66) {
    throw new Error(`Invalid ${name} (must be 0x-prefixed 32-byte hex, length 66)`);
  }
  return pk;
}

function requireChainId() {
  const raw = requireEnv("CHAIN_ID");
  const chainId = Number(raw);
  if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) {
    throw new Error(`Invalid CHAIN_ID (must be integer): ${raw}`);
  }
  return chainId;
}

async function getPimlicoGasPriceStandard(bundlerRpc) {
  const resp = await bundlerRpc.send("pimlico_getUserOperationGasPrice", []);
  const pick = resp?.standard ?? resp?.fast ?? resp?.slow;
  const maxFeePerGas = pick?.maxFeePerGas;
  const maxPriorityFeePerGas = pick?.maxPriorityFeePerGas;

  if (!isHexString(maxFeePerGas) || !isHexString(maxPriorityFeePerGas)) {
    throw new Error(`Invalid pimlico_getUserOperationGasPrice response: ${JSON.stringify(resp)}`);
  }

  return { maxFeePerGas, maxPriorityFeePerGas };
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

async function main() {
  const rpcUrl = requireEnv("RPC_URL");
  const bundlerUrl = requireEnv("BUNDLER_URL");
  const chainId = requireChainId();

  const entryPoint = requireEnv("ENTRYPOINT");
  const paymasterAddr = requireEnv("PAYMASTER");
  const routerAddr = requireEnv("ROUTER");
  const factoryAddr = requireEnv("FACTORY");

  const ownerEoa = requireEnv("OWNER_EOA");
  const token = requireEnv("TOKEN");
  const to = requireEnv("TO");
  const amount = BigInt(requireEnv("AMOUNT"));
  const finalFeeToken = BigInt(process.env.FINAL_FEE_TOKEN || process.env.FINAL_FEE || "0");
  const maxFeeUsd6 = BigInt(
    process.env.MAX_FEE_USDC6 || process.env.MAX_FEE_USD6 || process.env.MAX_FEE_USDC || "0"
  );
  const feeTokenMode = String(process.env.FEE_TOKEN_MODE || "same").toLowerCase();
  const feeToken = (process.env.FEE_TOKEN_ADDRESS || process.env.FEE_TOKEN || token).trim();

  if (finalFeeToken <= 0n) throw new Error("FINAL_FEE (token units) missing");
  if (maxFeeUsd6 <= 0n) throw new Error("MAX_FEE_USDC6 missing");

  let netAmount = amount;

  const signer = new ethers.Wallet(requirePrivateKey("PRIVATE_KEY_TEST_USER"));
  if (toLower(signer.address) !== toLower(ownerEoa)) {
    throw new Error(`OWNER_EOA must equal SimpleAccount owner. owner=${signer.address} ownerEoa=${ownerEoa}`);
  }

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);
  const ownerSigner = signer.connect(publicRpc);

  if (toLower(feeToken) === toLower(token)) {
    if (finalFeeToken > amount) {
      throw new Error(`FINAL_FEE must be <= AMOUNT. amount=${amount} finalFee=${finalFeeToken}`);
    }
    netAmount = amount - finalFeeToken;
  } else {
    const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
    const feeTokenContract = new ethers.Contract(feeToken, erc20Abi, publicRpc);
    const ownerFeeTokenBal = await feeTokenContract.balanceOf(ownerEoa);
    if (BigInt(ownerFeeTokenBal) < finalFeeToken) {
      throw new Error(`FEE_TOKEN_TOO_LOW: need ${finalFeeToken} have ${ownerFeeTokenBal}`);
    }
    netAmount = amount;
  }

  const supported = await bundlerRpc.send("eth_supportedEntryPoints", []);
  const supportedLower = (supported || []).map((a) => toLower(a));
  if (!supportedLower.includes(toLower(entryPoint))) {
    throw new Error(`Bundler does not support entryPoint ${entryPoint}. Supported: ${JSON.stringify(supported)}`);
  }

  const factoryAbi = [
    "function getAddress(address owner, uint256 salt) view returns (address)",
    "function createAccount(address owner, uint256 salt) returns (address)",
  ];
  const factory = new ethers.Contract(factoryAddr, factoryAbi, publicRpc);

  const salt = 0n;
  const sender = await factory["getAddress(address,uint256)"](ownerEoa, salt);
  console.log(`SENDER=${sender}`);

  const senderCode = await publicRpc.getCode(sender);
  const senderDeployed = typeof senderCode === "string" && senderCode !== "0x";

  const factoryData = factory.interface.encodeFunctionData("createAccount", [ownerEoa, salt]);

  const routerAbi = [
    "function sendERC20Permit2Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee,address owner)",
  ];
  const router = new ethers.Contract(routerAddr, routerAbi, publicRpc);

  const routerCallData = router.interface.encodeFunctionData("sendERC20Permit2Sponsored", [
    ownerEoa,
    token,
    to,
    amount,
    feeToken,
    finalFeeToken,
    ownerEoa,
  ]);

  const accountAbi = ["function execute(address dest,uint256 value,bytes func)"];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("execute", [routerAddr, 0n, routerCallData]);

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPriceStandard(bundlerRpc);

  const nowTs = Math.floor(Date.now() / 1000);
  const speed = 0;
  console.log(`USING_FINAL_FEE_TOKEN=${finalFeeToken}`);
  console.log(`USING_MAX_FEE_USD6=${maxFeeUsd6}`);
  console.log(`NET_AMOUNT=${netAmount}`);
  console.log(`FEE_TOKEN_USED=${feeToken}`);
  console.log(`TOKEN_SENT=${token}`);

  const now = BigInt(nowTs);
  const validAfter = now - 60n;
  const validUntil = now + 3600n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const paymasterData = coder.encode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    [0, speed, feeToken, BigInt(maxFeeUsd6), validUntil, validAfter]
  );

  const userOpNonce = await getNonce(publicRpc, entryPoint, sender);

  const gasDefaults = {
    callGasLimit: 500_000n,
    verificationGasLimit: 300_000n,
    preVerificationGas: 100_000n,
    paymasterVerificationGasLimit: 200_000n,
    paymasterPostOpGasLimit: 200_000n,
  };

  const userOp = {
    sender,
    nonce: hexlify(userOpNonce),
    ...(senderDeployed ? {} : { factory: factoryAddr, factoryData }),
    callData,
    callGasLimit: hexlify(gasDefaults.callGasLimit),
    verificationGasLimit: hexlify(gasDefaults.verificationGasLimit),
    preVerificationGas: hexlify(gasDefaults.preVerificationGas),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: paymasterAddr,
    paymasterVerificationGasLimit: hexlify(gasDefaults.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: hexlify(gasDefaults.paymasterPostOpGasLimit),
    paymasterData,
    signature: "0x",
  };

  const signWithGasFields = async () => {
    const initCode = senderDeployed ? "0x" : packInitCode(factoryAddr, factoryData);
    const accountGasLimits = packUint128Pair(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint128Pair(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    const paymasterAndData = packPaymasterAndData(
      paymasterAddr,
      BigInt(userOp.paymasterVerificationGasLimit),
      BigInt(userOp.paymasterPostOpGasLimit),
      paymasterData
    );

    const packed = {
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

    const userOpHash = await getUserOpHash(publicRpc, entryPoint, packed);
    userOp.signature = ownerSigner.signingKey.sign(userOpHash).serialized;
    return userOpHash;
  };

  await signWithGasFields();

  const estimate = await bundlerRpc.send("eth_estimateUserOperationGas", [userOp, entryPoint]);

  userOp.callGasLimit = estimate.callGasLimit ?? userOp.callGasLimit;
  userOp.verificationGasLimit = estimate.verificationGasLimit ?? userOp.verificationGasLimit;
  userOp.preVerificationGas = estimate.preVerificationGas ?? userOp.preVerificationGas;
  userOp.paymasterVerificationGasLimit = estimate.paymasterVerificationGasLimit ?? userOp.paymasterVerificationGasLimit;
  userOp.paymasterPostOpGasLimit = estimate.paymasterPostOpGasLimit ?? userOp.paymasterPostOpGasLimit;

  const finalHash = await signWithGasFields();
  console.log(`USEROP_HASH=${finalHash}`);

  const bundlerHash = await bundlerRpc.send("eth_sendUserOperation", [userOp, entryPoint]);
  console.log(`TX_SENT_USEROP=${bundlerHash}`);

}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
