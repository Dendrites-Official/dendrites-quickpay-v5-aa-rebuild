import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";

const PAYMASTER_ABI = [
  "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
];

const ACCOUNT_ABI = ["function execute(address dest,uint256 value,bytes func)"];
const ROUTER_ABI = [
  "function bulkSendUSDCWithAuthorization(address from,address token,address[] recipients,uint256[] amounts,uint256 feeAmount,bytes32 referenceId,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
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

function resolveBulkEnv(bulkKey, mainKey) {
  const bulkValue = String(process.env[bulkKey] || "").trim();
  if (bulkValue) return bulkValue;
  const allow = String(process.env.ALLOW_BULK_ON_MAIN_ADDRESSES || "").trim().toLowerCase() === "true";
  if (allow) {
    const mainValue = String(process.env[mainKey] || "").trim();
    if (mainValue) return mainValue;
  }
  throw new Error(`Missing ${bulkKey}. Set ${bulkKey} or ALLOW_BULK_ON_MAIN_ADDRESSES=true to use ${mainKey}.`);
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

function decodePaymasterData(paymasterData) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const [mode, speed, feeToken, maxFeeUsd6, validUntil, validAfter] = coder.decode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    paymasterData
  );
  return { mode, speed, feeToken, maxFeeUsd6, validUntil, validAfter };
}

function decodeFinalFeeFromCallData(callData) {
  const accountIface = new ethers.Interface(ACCOUNT_ABI);
  const routerIface = new ethers.Interface(ROUTER_ABI);
  const decodedAccount = accountIface.decodeFunctionData("execute", callData);
  const routerCallData = decodedAccount?.[2];
  const decodedRouter = routerIface.decodeFunctionData("bulkSendUSDCWithAuthorization", routerCallData);
  const feeToken = decodedRouter?.[1];
  const finalFee = decodedRouter?.[4];
  return {
    finalFee,
    feeToken,
    routerCallData,
  };
}

function assertDraftFees({
  draft,
  feeUsd6,
  feeTokenAmount,
  maxFeeUsd6,
  token,
  callData,
  paymasterData,
}) {
  if (feeUsd6 <= 0n || feeTokenAmount <= 0n) {
    throw new Error("Missing feeUsd6/feeTokenAmount in draft; would cause AA33 finalFee mismatch");
  }
  if (maxFeeUsd6 < feeUsd6) {
    throw new Error(`draft maxFeeUsd6 < feeUsd6 (${maxFeeUsd6} < ${feeUsd6})`);
  }

  const { finalFee, feeToken } = decodeFinalFeeFromCallData(callData);
  const { maxFeeUsd6: pmMaxFeeUsd6 } = decodePaymasterData(paymasterData);

  if (finalFee == null) {
    throw new Error("Unable to decode finalFee from callData");
  }
  if (BigInt(finalFee) !== feeTokenAmount) {
    throw new Error(`draft finalFee mismatch: callData=${finalFee} draft.feeTokenAmount=${feeTokenAmount}`);
  }
  if (feeToken && toLower(feeToken) !== toLower(token)) {
    throw new Error(`draft feeToken mismatch: callData=${feeToken} token=${token}`);
  }
  if (feeUsd6 > pmMaxFeeUsd6) {
    throw new Error(`draft feeUsd6 exceeds paymaster maxFeeUsd6 (${feeUsd6} > ${pmMaxFeeUsd6})`);
  }

  const baseline = draft?.baselineUsd6 != null ? BigInt(draft.baselineUsd6) : 0n;
  const surcharge = draft?.surchargeUsd6 != null ? BigInt(draft.surchargeUsd6) : 0n;
  if (baseline > 0n || surcharge > 0n) {
    const sum = baseline + surcharge;
    if (sum !== feeUsd6) {
      throw new Error(`draft feeUsd6 must equal baseline+surcharge (${feeUsd6} != ${sum})`);
    }
  }
}

function parseJsonList(envKey) {
  const raw = process.env[envKey];
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function main() {
  const jsonOut = getJsonOutPath();
  const rpcUrl = requireEnv("RPC_URL");
  const bundlerUrl = requireEnv("BUNDLER_URL");
  const chainId = requireChainId();

  const entryPoint = requireEnv("ENTRYPOINT");
  const paymasterAddr = resolveBulkEnv("PAYMASTER_BULK", "PAYMASTER");
  const routerAddr = resolveBulkEnv("ROUTER_BULK", "ROUTER");
  const factoryAddr = requireEnv("FACTORY");

  const ownerEoa = requireEnv("OWNER_EOA");
  const token = requireEnv("TOKEN");
  const recipients = parseJsonList("RECIPIENTS_JSON");
  const amountsRaw = parseJsonList("AMOUNTS_JSON");
  const finalFeeToken = BigInt(process.env.FINAL_FEE_TOKEN || process.env.FINAL_FEE || "0");
  const maxFeeUsd6 = BigInt(
    process.env.MAX_FEE_USDC6 || process.env.MAX_FEE_USD6 || process.env.MAX_FEE_USDC || "0"
  );
  const speedRaw = String(process.env.SPEED ?? "").trim();
  const speed = speedRaw === "" ? 1 : Number(speedRaw);
  const feeTokenMode = String(process.env.FEE_TOKEN_MODE || "same").toLowerCase();
  const feeToken = (process.env.FEE_TOKEN_ADDRESS || process.env.FEE_TOKEN || token).trim();
  const referenceId = String(process.env.REFERENCE_ID || "0x").trim();
  const userOpSignature = String(process.env.USEROP_SIGNATURE || "").trim();
  const userOpDraftRaw = process.env.USEROP_DRAFT_JSON;
  const userOpDraft = userOpDraftRaw ? JSON.parse(userOpDraftRaw) : null;
  const authRaw = process.env.AUTH_JSON;
  const authJson = authRaw ? JSON.parse(authRaw) : null;

  void feeTokenMode;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("RECIPIENTS_JSON missing or empty");
  }
  if (!Array.isArray(amountsRaw) || recipients.length !== amountsRaw.length) {
    throw new Error("AMOUNTS_JSON missing or length mismatch");
  }

  const amounts = amountsRaw.map((value) => BigInt(String(value)));
  const totalNet = amounts.reduce((acc, value) => acc + value, 0n);
  const amount = totalNet + finalFeeToken;

  if (!userOpDraft) {
    if (finalFeeToken <= 0n) throw new Error("FINAL_FEE (token units) missing");
    if (maxFeeUsd6 <= 0n) throw new Error("MAX_FEE_USDC6 missing");
    if (toLower(feeToken) !== toLower(token)) {
      throw new Error(`feeToken must equal token for EIP-3009. feeToken=${feeToken} token=${token}`);
    }
    if (finalFeeToken > amount) {
      throw new Error(`FINAL_FEE must be <= AMOUNT. amount=${amount} finalFee=${finalFeeToken}`);
    }
    if (!authJson || authJson.type !== "EIP3009") {
      throw new Error("AUTH_JSON missing for EIP3009");
    }
  }

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);
  const nowTs = Math.floor(Date.now() / 1000);
  let feeUsd6 = 0n;
  let baselineUsd6 = 0n;
  let surchargeUsd6 = 0n;
  if (!userOpDraft) {
    const paymasterContract = new ethers.Contract(paymasterAddr, PAYMASTER_ABI, publicRpc);
    const quoteRaw = await paymasterContract.quoteFeeUsd6(ownerEoa, 0, speed, nowTs);
    baselineUsd6 = BigInt(quoteRaw[0]);
    surchargeUsd6 = BigInt(quoteRaw[1]);
    feeUsd6 = baselineUsd6 + surchargeUsd6;
  }

  const supported = await bundlerRpc.send("eth_supportedEntryPoints", []);
  const supportedLower = (supported || []).map((a) => toLower(a));
  if (!supportedLower.includes(toLower(entryPoint))) {
    throw new Error(`Bundler does not support entryPoint ${entryPoint}. Supported: ${JSON.stringify(supported)}`);
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

    const draftFeeUsd6 = BigInt(requireDraftField(userOpDraft, "feeUsd6"));
    const draftFeeTokenAmount = BigInt(requireDraftField(userOpDraft, "feeTokenAmount"));
    const draftMaxFeeUsd6 = BigInt(requireDraftField(userOpDraft, "maxFeeUsd6"));
    const draftBaselineUsd6 = BigInt(requireDraftField(userOpDraft, "baselineUsd6"));
    const draftSurchargeUsd6 = BigInt(requireDraftField(userOpDraft, "surchargeUsd6"));

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

    assertDraftFees({
      draft: userOpDraft,
      feeUsd6: draftFeeUsd6,
      feeTokenAmount: draftFeeTokenAmount,
      maxFeeUsd6: draftMaxFeeUsd6,
      token,
      callData: draftUserOp.callData,
      paymasterData: draftUserOp.paymasterData,
    });

    const bundlerHash = await bundlerRpc.send("eth_sendUserOperation", [draftUserOp, entryPoint]);
    void bundlerHash;

    let txHash = null;
    for (let i = 0; i < 15; i += 1) {
      const receipt = await bundlerRpc.send("eth_getUserOperationReceipt", [bundlerHash]);
      txHash = receipt?.receipt?.transactionHash ?? receipt?.transactionHash ?? null;
      if (txHash) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    writeJson(jsonOut, {
      ok: true,
      lane: "EIP3009_BULK",
      userOpHash,
      txHash,
      feeAmountRaw: finalFeeToken.toString(),
      netAmountRaw: totalNet.toString(),
    });
    return;
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

  let validAfter;
  let validBefore;
  let nonce;
  let signature;

  if (!authJson?.signature) {
    throw new Error("AUTH_JSON missing for EIP3009");
  }
  if (authJson.from && toLower(authJson.from) !== toLower(ownerEoa)) {
    throw new Error(`auth.from mismatch`);
  }
  if (authJson.to && toLower(authJson.to) !== toLower(routerAddr)) {
    throw new Error(`auth.to mismatch (must be router)`);
  }
  if (authJson.value != null && String(authJson.value) !== String(amount)) {
    throw new Error(`auth.value mismatch`);
  }
  validAfter = BigInt(authJson.validAfter || 0);
  validBefore = BigInt(authJson.validBefore || 0);
  nonce = authJson.nonce;
  signature = String(authJson.signature);

  const router = new ethers.Contract(routerAddr, ROUTER_ABI, publicRpc);
  const routerCallData = router.interface.encodeFunctionData("bulkSendUSDCWithAuthorization", [
    ownerEoa,
    token,
    recipients,
    amounts.map((v) => BigInt(v)),
    finalFeeToken,
    referenceId,
    validAfter,
    validBefore,
    nonce,
    signature,
  ]);

  const accountIface = new ethers.Interface(ACCOUNT_ABI);
  const callData = accountIface.encodeFunctionData("execute", [routerAddr, 0n, routerCallData]);

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPriceStandard(bundlerRpc);

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
    callGasLimit: 900_000n,
    verificationGasLimit: 300_000n,
    preVerificationGas: 120_000n,
    paymasterVerificationGasLimit: 260_000n,
    paymasterPostOpGasLimit: 260_000n,
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
      lane: "EIP3009_BULK",
      userOpHash,
      message: "SIGN_THIS_USEROP_HASH_WITH_eth_sign",
      userOpDraft: {
        lane: "EIP3009_BULK",
        feeUsd6: feeUsd6.toString(),
        feeTokenAmount: finalFeeToken.toString(),
        baselineUsd6: baselineUsd6.toString(),
        surchargeUsd6: surchargeUsd6.toString(),
        maxFeeUsd6: BigInt(maxFeeUsd6).toString(),
        token,
        recipients,
        amounts: amounts.map((v) => v.toString()),
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
    lane: "EIP3009_BULK",
    userOpHash,
    txHash,
    feeAmountRaw: finalFeeToken.toString(),
    netAmountRaw: totalNet.toString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
