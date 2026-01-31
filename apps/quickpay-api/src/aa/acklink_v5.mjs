import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";

const ACCOUNT_ABI = [
  "function execute(address dest,uint256 value,bytes func)",
  "function executeBatch(address[] dest,uint256[] value,bytes[] func)",
];

const ACKLINK_ABI = [
  "function createLinkWithAuthorization(address from,uint256 totalUsdc6,uint256 feeUsdc6,uint64 expiresAt,bytes32 metaHash,bytes32 codeHash,bytes32 nonce,uint64 validAfter,uint64 validBefore,uint8 v,bytes32 r,bytes32 s) returns (bytes32)",
  "function claim(bytes32 linkId,address to,bytes code)",
  "function refund(bytes32 linkId)",
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

function toBytesArg(value) {
  if (isHexString(value)) return value;
  return ethers.hexlify(ethers.toUtf8Bytes(String(value)));
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

function requireDraftField(draft, key) {
  const value = draft?.[key];
  if (value == null || value === "") {
    throw new Error(`USEROP_DRAFT_JSON missing ${key}`);
  }
  return value;
}

function buildPackedUserOpFromUserOp(userOp) {
  const initCode = userOp.factory && userOp.factoryData ? packInitCode(userOp.factory, userOp.factoryData) : "0x";
  const accountGasLimits = packUint128Pair(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
  const gasFees = packUint128Pair(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
  const paymasterAndData = packPaymasterAndData(
    userOp.paymaster,
    BigInt(userOp.paymasterVerificationGasLimit),
    BigInt(userOp.paymasterPostOpGasLimit),
    userOp.paymasterData || "0x"
  );

  return {
    sender: userOp.sender,
    nonce: BigInt(userOp.nonce),
    initCode,
    callData: userOp.callData,
    accountGasLimits,
    preVerificationGas: BigInt(userOp.preVerificationGas),
    gasFees,
    paymasterAndData,
    signature: userOp.signature || "0x",
  };
}

function buildPaymasterData({ speed, feeToken, maxFeeUsd6 }) {
  const nowTs = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(nowTs) - 60n;
  const validUntil = BigInt(nowTs) + 3600n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    [3, speed, feeToken, BigInt(maxFeeUsd6), validUntil, validAfter]
  );
}

async function main() {
  const jsonOut = getJsonOutPath();
  const rpcUrl = requireEnv("RPC_URL");
  const bundlerUrl = requireEnv("BUNDLER_URL");
  const chainId = requireChainId();

  const entryPoint = requireEnv("ENTRYPOINT");
  const paymasterAddr = requireEnv("PAYMASTER");
  const factoryAddr = requireEnv("FACTORY");

  const ownerEoa = requireEnv("OWNER_EOA");
  const usdc = requireEnv("USDC");
  const feeVault = requireEnv("FEEVAULT");
  const acklinkVault = requireEnv("ACKLINK_VAULT");

  const action = String(process.env.ACTION || "CREATE").trim().toUpperCase();
  const speedRaw = String(process.env.SPEED ?? "").trim();
  const speed = speedRaw === "" ? 0 : Number(speedRaw);

  const userOpSignature = String(process.env.USEROP_SIGNATURE || "").trim();
  const userOpDraftRaw = process.env.USEROP_DRAFT_JSON;
  const userOpDraft = userOpDraftRaw ? JSON.parse(userOpDraftRaw) : null;

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);

  const supported = await bundlerRpc.send("eth_supportedEntryPoints", []);
  const supportedLower = (supported || []).map((a) => toLower(a));
  if (!supportedLower.includes(toLower(entryPoint))) {
    throw new Error(`Bundler does not support entryPoint ${entryPoint}. Supported: ${JSON.stringify(supported)}`);
  }

  const accountIface = new ethers.Interface(ACCOUNT_ABI);
  const ackIface = new ethers.Interface(ACKLINK_ABI);

  let callData = "0x";
  let feeUsd6 = 0n;
  let feeTokenAmount = 0n;

  if (action === "CREATE") {
    const amount = BigInt(requireEnv("AMOUNT"));
    const feeUsdc6 = BigInt(requireEnv("FEE_USDC6"));
    const expiresAt = BigInt(requireEnv("EXPIRES_AT"));
    const metaHash = requireEnv("META_HASH");
    const codeHash = requireEnv("CODE_HASH");

    const authFrom = requireEnv("AUTH_FROM");
    const authValue = BigInt(requireEnv("AUTH_VALUE"));
    const authValidAfter = BigInt(requireEnv("AUTH_VALID_AFTER"));
    const authValidBefore = BigInt(requireEnv("AUTH_VALID_BEFORE"));
    const authNonce = requireEnv("AUTH_NONCE");
    const authV = Number(requireEnv("AUTH_V"));
    const authR = requireEnv("AUTH_R");
    const authS = requireEnv("AUTH_S");

    const createCallData = ackIface.encodeFunctionData("createLinkWithAuthorization", [
      authFrom,
      authValue,
      feeUsdc6,
      expiresAt,
      metaHash,
      codeHash,
      authNonce,
      authValidAfter,
      authValidBefore,
      authV,
      authR,
      authS,
    ]);

    callData = accountIface.encodeFunctionData("execute", [acklinkVault, 0n, createCallData]);

    feeUsd6 = feeUsdc6;
    feeTokenAmount = feeUsdc6;
  } else if (action === "CLAIM") {
    const linkId = requireEnv("LINK_ID");
    const claimTo = requireEnv("CLAIM_TO");
    const claimCode = requireEnv("CLAIM_CODE");
    const claimCallData = ackIface.encodeFunctionData("claim", [linkId, claimTo, toBytesArg(claimCode)]);
    callData = accountIface.encodeFunctionData("execute", [acklinkVault, 0n, claimCallData]);
  } else if (action === "REFUND") {
    const linkId = requireEnv("LINK_ID");
    const refundCallData = ackIface.encodeFunctionData("refund", [linkId]);
    callData = accountIface.encodeFunctionData("execute", [acklinkVault, 0n, refundCallData]);
  } else {
    throw new Error(`Unknown ACTION=${action}`);
  }

  const envMaxFee = String(process.env.MAX_FEE_USDC6 || process.env.MAX_FEE_USD6 || "").trim();
  let maxFeeUsd6 = feeUsd6;
  if (action === "CREATE") {
    maxFeeUsd6 = envMaxFee ? BigInt(envMaxFee) : feeUsd6;
  } else {
    maxFeeUsd6 = 0n;
  }

  if (userOpDraft) {
    if (!userOpSignature) {
      throw new Error("USEROP_SIGNATURE missing for USEROP_DRAFT_JSON");
    }
    if (userOpDraft.factory && !userOpDraft.factoryData) {
      throw new Error("USEROP_DRAFT_JSON missing factoryData");
    }
    if (userOpDraft.factoryData && !userOpDraft.factory) {
      throw new Error("USEROP_DRAFT_JSON missing factory");
    }

    const draftUserOp = {
      sender: requireDraftField(userOpDraft, "sender"),
      nonce: requireDraftField(userOpDraft, "nonce"),
      factory: userOpDraft.factory || undefined,
      factoryData: userOpDraft.factoryData || undefined,
      callData: requireDraftField(userOpDraft, "callData"),
      callGasLimit: requireDraftField(userOpDraft, "callGasLimit"),
      verificationGasLimit: requireDraftField(userOpDraft, "verificationGasLimit"),
      preVerificationGas: requireDraftField(userOpDraft, "preVerificationGas"),
      maxFeePerGas: requireDraftField(userOpDraft, "maxFeePerGas"),
      maxPriorityFeePerGas: requireDraftField(userOpDraft, "maxPriorityFeePerGas"),
      paymaster: requireDraftField(userOpDraft, "paymaster"),
      paymasterVerificationGasLimit: requireDraftField(userOpDraft, "paymasterVerificationGasLimit"),
      paymasterPostOpGasLimit: requireDraftField(userOpDraft, "paymasterPostOpGasLimit"),
      paymasterData: requireDraftField(userOpDraft, "paymasterData"),
      signature: userOpSignature,
    };

    const userOpHash = await getUserOpHash(publicRpc, entryPoint, buildPackedUserOpFromUserOp(draftUserOp));
    const bundlerHash = await bundlerRpc.send("eth_sendUserOperation", [draftUserOp, entryPoint]);
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
      lane: "ACKLINK",
      userOpHash,
      txHash,
    });
    return;
  }

  const factoryAbi = [
    "function getAddress(address owner, uint256 salt) view returns (address)",
    "function createAccount(address owner, uint256 salt) returns (address)",
  ];
  const senderOverride = String(process.env.SENDER_OVERRIDE || "").trim();
  const deployedOverride = String(process.env.SENDER_DEPLOYED || "").trim();

  const factory = new ethers.Contract(factoryAddr, factoryAbi, publicRpc);
  const sender = senderOverride ? senderOverride : await factory.getAddress(ownerEoa, 0n);

  let senderDeployed = false;
  if (senderOverride && (deployedOverride === "1" || deployedOverride === "0")) {
    senderDeployed = deployedOverride === "1";
  } else {
    const senderCode = await publicRpc.getCode(sender);
    senderDeployed = senderCode && senderCode !== "0x";
  }

  const factoryData = factory.interface.encodeFunctionData("createAccount", [ownerEoa, 0n]);

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPriceStandard(bundlerRpc);

  const paymasterData = buildPaymasterData({ speed, feeToken: usdc, maxFeeUsd6 });
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
    const userOpHash = await getUserOpHash(publicRpc, entryPoint, buildPackedUserOp());
    writeJson(jsonOut, {
      ok: false,
      needsUserOpSignature: true,
      lane: "ACKLINK",
      userOpHash,
      message: "SIGN_THIS_USEROP_HASH_WITH_eth_sign",
      userOpDraft: {
        lane: "ACKLINK",
        action,
        feeUsd6: feeUsd6.toString(),
        feeTokenAmount: feeTokenAmount.toString(),
        maxFeeUsd6: maxFeeUsd6.toString(),
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
    lane: "ACKLINK",
    userOpHash,
    txHash,
  });
}

main().catch((err) => {
  const out = getJsonOutPath();
  if (out) {
    writeJson(out, { ok: false, error: err?.message || String(err) });
  }
  throw err;
});
