import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";

const PAYMASTER_ABI = [
  "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
];

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

function getJsonOutPath() {
  const idx = process.argv.indexOf("--json-out");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function writeJson(outPath, obj) {
  if (!outPath) return;
  fs.writeFileSync(outPath, JSON.stringify(obj));
}

async function main() {
  const jsonOut = getJsonOutPath();
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
  const feeToken = (process.env.FEE_TOKEN_ADDRESS || process.env.FEE_TOKEN || token).trim();
  const userOpSignature = String(process.env.USEROP_SIGNATURE || "").trim();
  const authRaw = process.env.AUTH_JSON;
  const authJson = authRaw ? JSON.parse(authRaw) : null;

  if (finalFeeToken <= 0n) throw new Error("FINAL_FEE (token units) missing");
  if (maxFeeUsd6 <= 0n) throw new Error("MAX_FEE_USDC6 missing");
  if (toLower(feeToken) !== toLower(token)) {
    throw new Error(`feeToken must equal token for EIP-2612. feeToken=${feeToken} token=${token}`);
  }
  if (finalFeeToken > amount) {
    throw new Error(`FINAL_FEE must be <= AMOUNT. amount=${amount} finalFee=${finalFeeToken}`);
  }
  if (!authJson || (!authJson.type && !(authJson.owner && authJson.spender && authJson.signature))) {
    throw new Error("AUTH_JSON missing for EIP2612");
  }
  if (authJson.type && authJson.type !== "EIP2612") {
    throw new Error("AUTH_JSON missing for EIP2612");
  }

  const netAmount = amount - finalFeeToken;

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);
  const speed = Number(process.env.SPEED || "0");
  const nowTs = Math.floor(Date.now() / 1000);
  let feeUsd6 = 0n;
  let baselineUsd6 = 0n;
  let surchargeUsd6 = 0n;
  const paymasterContract = new ethers.Contract(paymasterAddr, PAYMASTER_ABI, publicRpc);
  const quoteRaw = await paymasterContract.quoteFeeUsd6(ownerEoa, 0, speed, nowTs);
  baselineUsd6 = BigInt(quoteRaw[0]);
  surchargeUsd6 = BigInt(quoteRaw[1]);
  feeUsd6 = baselineUsd6 + surchargeUsd6;

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

  let deadline;
  let v;
  let r;
  let s;

  if (!authJson?.signature) {
    throw new Error("AUTH_JSON missing for EIP2612");
  }
  if (authJson.owner && toLower(authJson.owner) !== toLower(ownerEoa)) {
    throw new Error(`auth.owner mismatch`);
  }
  if (authJson.spender && toLower(authJson.spender) !== toLower(routerAddr)) {
    throw new Error(`auth.spender mismatch (must be router)`);
  }
  if (authJson.value != null && String(authJson.value) !== String(amount)) {
    throw new Error(`auth.value mismatch`);
  }
  deadline = BigInt(authJson.deadline || 0);
  const sig = ethers.Signature.from(String(authJson.signature));
  v = sig.v;
  r = sig.r;
  s = sig.s;

  const routerAbi = [
    "function sendERC20EIP2612Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee,address owner,uint256 permitDeadline,uint8 v,bytes32 r,bytes32 s)",
  ];
  const router = new ethers.Contract(routerAddr, routerAbi, publicRpc);

  const routerCallData = router.interface.encodeFunctionData("sendERC20EIP2612Sponsored", [
    ownerEoa,
    token,
    to,
    amount,
    token,
    finalFeeToken,
    ownerEoa,
    deadline,
    v,
    r,
    s,
  ]);

  const accountAbi = ["function execute(address dest,uint256 value,bytes func)"];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("execute", [routerAddr, 0n, routerCallData]);

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPriceStandard(bundlerRpc);

  console.log(`NET_AMOUNT=${netAmount}`);

  const now = BigInt(nowTs);
  const paymasterValidAfter = now - 60n;
  const paymasterValidUntil = now + 3600n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const paymasterData = coder.encode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    [0, speed, feeToken, BigInt(maxFeeUsd6), paymasterValidUntil, paymasterValidAfter]
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

  const buildPackedUserOp = () => {
    const initCode = senderDeployed ? "0x" : packInitCode(factoryAddr, factoryData);
    const accountGasLimits = packUint128Pair(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint128Pair(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    const paymasterAndData = packPaymasterAndData(
      paymasterAddr,
      BigInt(userOp.paymasterVerificationGasLimit),
      BigInt(userOp.paymasterPostOpGasLimit),
      paymasterData
    );

    return {
      sender,
      nonce: userOpNonce,
      initCode,
      callData,
      accountGasLimits,
      preVerificationGas: BigInt(userOp.preVerificationGas),
      gasFees,
      paymasterAndData,
      signature: userOp.signature || "0x",
    };
  };

  if (!userOpSignature) {
    userOp.signature = "0x";
    const userOpHash = await getUserOpHash(publicRpc, entryPoint, buildPackedUserOp());
    writeJson(jsonOut, {
      ok: false,
      needsUserOpSignature: true,
      lane: "EIP2612",
      userOpHash,
      message: "SIGN_THIS_USEROP_HASH_WITH_eth_sign",
      userOpDraft: {
        lane: "EIP2612",
        feeUsd6: feeUsd6.toString(),
        feeTokenAmount: finalFeeToken.toString(),
        baselineUsd6: baselineUsd6.toString(),
        surchargeUsd6: surchargeUsd6.toString(),
        maxFeeUsd6: BigInt(maxFeeUsd6).toString(),
        token,
        to,
        amount: amount.toString(),
        smartSender: sender,
        sender: userOp.sender,
        nonce: userOp.nonce,
        factory: userOp.factory,
        factoryData: userOp.factoryData,
        callData: userOp.callData,
        callGasLimit: userOp.callGasLimit,
        verificationGasLimit: userOp.verificationGasLimit,
        preVerificationGas: userOp.preVerificationGas,
        maxFeePerGas: userOp.maxFeePerGas,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
        paymaster: userOp.paymaster,
        paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit,
        paymasterData,
      },
    });
    process.exit(2);
  }

  userOp.signature = userOpSignature;
  const userOpHash = await getUserOpHash(publicRpc, entryPoint, buildPackedUserOp());
  const bundlerHash = await bundlerRpc.send("eth_sendUserOperation", [userOp, entryPoint]);
  void bundlerHash;

  let txHash = null;
  for (let i = 0; i < 15; i += 1) {
    const receipt = await bundlerRpc.send("eth_getUserOperationReceipt", [userOpHash]);
    txHash = receipt?.receipt?.transactionHash ?? receipt?.transactionHash ?? null;
    if (txHash) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  writeJson(jsonOut, {
    ok: true,
    lane: "EIP2612",
    userOpHash,
    txHash,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
