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
  const speedRaw = String(process.env.SPEED ?? "").trim();
  const speed = speedRaw === "" ? 0 : Number(speedRaw);
  const feeTokenMode = String(process.env.FEE_TOKEN_MODE || "same").toLowerCase();
  const feeToken = (process.env.FEE_TOKEN_ADDRESS || process.env.FEE_TOKEN || token).trim();
  const userOpSignature = String(process.env.USEROP_SIGNATURE || "").trim();
  const userOpDraftRaw = process.env.USEROP_DRAFT_JSON;
  const userOpDraft = userOpDraftRaw ? JSON.parse(userOpDraftRaw) : null;
  const authRaw = process.env.AUTH_JSON;
  const authJson = authRaw ? JSON.parse(authRaw) : null;
  const permit2Addr = String(process.env.PERMIT2 || "").trim();

  if (!ethers.isAddress(permit2Addr)) {
    throw new Error("PERMIT2 env missing or invalid");
  }

  if (!userOpDraft) {
    if (finalFeeToken <= 0n) throw new Error("FINAL_FEE (token units) missing");
    if (maxFeeUsd6 <= 0n) throw new Error("MAX_FEE_USDC6 missing");
    if (!authJson || authJson.type !== "PERMIT2") {
      throw new Error("AUTH_JSON missing for PERMIT2");
    }
  }

  let netAmount = amount;

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);

  if (!userOpDraft) {
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
      const receipt = await bundlerRpc.send("eth_getUserOperationReceipt", [bundlerHash]);
      txHash = receipt?.receipt?.transactionHash ?? receipt?.transactionHash ?? null;
      if (txHash) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    writeJson(jsonOut, {
      ok: true,
      lane: "PERMIT2",
      userOpHash,
      txHash,
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
  console.log(`SENDER=${sender}`);

  const senderCode = await publicRpc.getCode(sender);
  const senderDeployed = typeof senderCode === "string" && senderCode !== "0x";

  const factoryData = factory.interface.encodeFunctionData("createAccount", [ownerEoa, salt]);

  const permit2Addr = String(process.env.PERMIT2 || "").trim();
  if (!ethers.isAddress(permit2Addr)) {
    throw new Error("PERMIT2 env missing or invalid");
  }

  const routerAbi = [
    "function sendERC20Permit2Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee,address owner)",
  ];
  const permit2Abi = [
    "function permit(address owner,((address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline) permitSingle,bytes signature)",
  ];
  const router = new ethers.Contract(routerAddr, routerAbi, publicRpc);
  const permit2 = new ethers.Contract(permit2Addr, permit2Abi, publicRpc);

  if (!authJson?.signature) {
    throw new Error("AUTH_JSON missing signature for PERMIT2");
  }
  if (!authJson?.details || !authJson?.spender || !authJson?.sigDeadline) {
    throw new Error("AUTH_JSON missing Permit2 fields");
  }
  if (toLower(authJson.spender) !== toLower(routerAddr)) {
    throw new Error(`PERMIT2 spender mismatch. auth.spender=${authJson.spender} router=${routerAddr}`);
  }
  if (toLower(authJson.details.token) !== toLower(token)) {
    throw new Error(`PERMIT2 token mismatch. auth.details.token=${authJson.details.token} token=${token}`);
  }
  if (BigInt(authJson.details.amount || 0) < amount) {
    throw new Error(`PERMIT2 amount too low. auth.details.amount=${authJson.details.amount} amount=${amount}`);
  }

  const permitSingle = {
    details: {
      token: authJson.details.token,
      amount: BigInt(authJson.details.amount),
      expiration: BigInt(authJson.details.expiration),
      nonce: BigInt(authJson.details.nonce),
    },
    spender: authJson.spender,
    sigDeadline: BigInt(authJson.sigDeadline),
  };

  const permitCallData = permit2.interface.encodeFunctionData("permit", [
    ownerEoa,
    permitSingle,
    authJson.signature,
  ]);

  const routerCallData = router.interface.encodeFunctionData("sendERC20Permit2Sponsored", [
    ownerEoa,
    token,
    to,
    amount,
    feeToken,
    finalFeeToken,
    ownerEoa,
  ]);

  const accountAbi = [
    "function execute(address dest,uint256 value,bytes func)",
    "function executeBatch(address[] dest,uint256[] value,bytes[] func)",
  ];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("executeBatch", [
    [permit2Addr, routerAddr],
    [0n, 0n],
    [permitCallData, routerCallData],
  ]);

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPriceStandard(bundlerRpc);

  const nowTs = Math.floor(Date.now() / 1000);
  let feeUsd6 = 0n;
  let baselineUsd6 = 0n;
  let surchargeUsd6 = 0n;
  const paymasterContract = new ethers.Contract(paymasterAddr, PAYMASTER_ABI, publicRpc);
  const quoteRaw = await paymasterContract.quoteFeeUsd6(ownerEoa, 0, speed, nowTs);
  baselineUsd6 = BigInt(quoteRaw[0]);
  surchargeUsd6 = BigInt(quoteRaw[1]);
  feeUsd6 = baselineUsd6 + surchargeUsd6;
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
      lane: "PERMIT2",
      userOpHash,
      message: "SIGN_THIS_USEROP_HASH_WITH_eth_sign",
      userOpDraft: {
        lane: "PERMIT2",
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
    lane: "PERMIT2",
    userOpHash,
    txHash,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
