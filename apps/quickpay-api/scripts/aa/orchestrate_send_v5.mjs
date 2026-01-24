import "dotenv/config";
import { ethers } from "ethers";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
function emitUx(type, data = {}) {
  const evt = { ts: new Date().toISOString(), type, ...data };
  console.log("UX_EVENT=" + JSON.stringify(evt));
  return evt;
}

let bundlerUrlGlobal = "";

async function rpcBundler(method, params) {
  if (!bundlerUrlGlobal) throw new Error("Missing bundler URL");
  const res = await fetch(bundlerUrlGlobal, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "Bundler error");
  return json.result;
}

async function getUserOpReceipt(userOpHash) {
  return await rpcBundler("eth_getUserOperationReceipt", [userOpHash]);
}

async function waitForUserOpReceipt(userOpHash) {
  const timeoutMs = Number(process.env.RECEIPT_TIMEOUT_MS ?? "120000");
  const pollMs = Number(process.env.RECEIPT_POLL_MS ?? "1500");
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const rec = await getUserOpReceipt(userOpHash);
    if (rec) return rec;
    emitUx("RECEIPT_POLL", { userOpHash, elapsedMs: String(Date.now() - t0) });
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

async function waitForStipendSettlement({ provider, owner, targetWei, timeoutMs, stipendUserOpHash }) {
  const start = Date.now();
  let attempt = 0;
  let lastBal = 0n;
  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    lastBal = await provider.getBalance(owner);
    emitUx("PERMIT2_STIPEND_WAIT_POLL", {
      attempt,
      ownerEthBalWei: lastBal.toString(),
      elapsedMs: String(Date.now() - start),
    });
    if (lastBal >= targetWei) {
      emitUx("PERMIT2_STIPEND_WAIT_DONE", { finalOwnerEthBalWei: lastBal.toString() });
      return lastBal;
    }

    if (stipendUserOpHash) {
      try {
        const receipt = await getUserOpReceipt(stipendUserOpHash);
        if (receipt) {
          emitUx("PERMIT2_STIPEND_RECEIPT_STATUS", {
            userOpHash: stipendUserOpHash,
            success: receipt.success ?? null,
            txHash: receipt.receipt?.transactionHash || "",
          });
        }
      } catch {
        // ignore receipt errors
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  emitUx("PERMIT2_STIPEND_WAIT_TIMEOUT", {
    ownerEthBalWei: lastBal.toString(),
    targetWei: targetWei.toString(),
    elapsedMs: String(Date.now() - start),
    stipendUserOpHash: stipendUserOpHash || "",
  });
  throw new Error("PERMIT2_STIPEND_TIMEOUT");
}

function parseArgs(argv) {
  const out = { jsonOutPath: "out/orchestrate_last.json", resumeUserOpHash: "", receiptOnly: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json-out" && argv[i + 1]) {
      out.jsonOutPath = argv[i + 1];
      i += 1;
    } else if (arg === "--resume-userop" && argv[i + 1]) {
      out.resumeUserOpHash = argv[i + 1];
      i += 1;
    } else if (arg === "--receipt-only") {
      out.receiptOnly = true;
    }
  }
  return out;
}

function requireEnv(name, fallback = null) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    if (fallback != null) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function toLower(addr) {
  return String(addr).toLowerCase();
}

function parseFeeMode(raw) {
  const v = String(raw).trim().toLowerCase();
  if (v !== "eco" && v !== "instant") throw new Error(`Invalid FEE_MODE: ${raw}`);
  return v === "instant" ? 1 : 0;
}

function parseBoolEnv(name, defaultValue) {
  const raw = String(process.env[name] ?? defaultValue).trim();
  return raw !== "0";
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

async function estimateSelfPayGasFallback(provider) {
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
  const gasLimitFallback = 60000n;
  const estCostWei = gasLimitFallback * maxFeePerGas;
  return {
    gasLimit: gasLimitFallback.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    estCostWei: estCostWei.toString(),
    estCostEth: ethers.formatEther(estCostWei),
  };
}

async function computeFinalFeeTokenAmount(paymaster, payer, feeToken, speed, nowTs) {
  const [baselineUsd6, surchargeUsd6, _finalFeeUsd6, _capBps, maxFeeRequiredUsd6] =
    await paymaster.quoteFeeUsd6(payer, 0, speed, nowTs);

  const totalUsd6 = BigInt(baselineUsd6) + BigInt(surchargeUsd6);
  const decBn = await paymaster.feeTokenDecimals(feeToken);
  const price = await paymaster.usd6PerWholeToken(feeToken);

  const decimals = Number(decBn);
  const pow10 = 10n ** BigInt(decimals);
  const finalFeeTokenAmount = ceilDiv(totalUsd6 * pow10, BigInt(price));

  return { baselineUsd6, surchargeUsd6, totalUsd6, maxFeeRequiredUsd6, finalFeeTokenAmount, decimals, price };
}

function extractUserOpHash(output) {
  const match = String(output || "").match(/USEROP_HASH=([0x0-9a-fA-F]+)/);
  return match ? match[1] : "";
}

function extractStipendUserOpHash(output) {
  const match = String(output || "").match(/ACTIVATE_STIPEND_USEROP_HASH=([0x0-9a-fA-F]+)/);
  return match ? match[1] : "";
}

function isInsufficientFunds(err) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return msg.includes("insufficient funds") || msg.includes("out of funds") || msg.includes("insufficient balance");
}

function summarizeTransfers(receipt, token, to, feeVault) {
  if (!receipt) return { toAmount: "0", feeAmount: "0" };
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const logs = Array.isArray(receipt?.receipt?.logs) && receipt.receipt.logs.length
    ? receipt.receipt.logs
    : Array.isArray(receipt?.logs)
      ? receipt.logs
      : [];
  const toTopic = ethers.zeroPadValue(ethers.getAddress(to), 32).toLowerCase();
  const feeTopic = ethers.zeroPadValue(ethers.getAddress(feeVault), 32).toLowerCase();
  let toSum = 0n;
  let feeSum = 0n;
  for (const log of logs) {
    if (!log || !log.topics || log.topics[0]?.toLowerCase() !== transferTopic) continue;
    if (log.address?.toLowerCase() !== token.toLowerCase()) continue;
    const topicTo = log.topics[2]?.toLowerCase();
    if (!topicTo) continue;
    const amount = BigInt(log.data ?? "0x0");
    if (topicTo === toTopic) toSum += amount;
    if (topicTo === feeTopic) feeSum += amount;
  }
  return { toAmount: toSum.toString(), feeAmount: feeSum.toString() };
}

function formatSetupTxs(tokenApproveTxHash, permit2ApproveTxHash, stipendUserOpHash) {
  const norm = (value) => (value && value !== "none" ? value : "");
  const hasAny = Boolean(norm(tokenApproveTxHash) || norm(permit2ApproveTxHash) || norm(stipendUserOpHash));
  if (!hasAny) return "none";
  const parts = [
    norm(tokenApproveTxHash) || "none",
    norm(permit2ApproveTxHash) || "none",
    norm(stipendUserOpHash) || "none",
  ];
  return `permit2_setup(${parts.join(",")})`;
}

async function main(options = {}) {
  const resumeUserOpHash = options.resumeUserOpHash || "";
  const receiptOnly = !!options.receiptOnly;
  const result = {
    env: {
      rpcUrl: process.env.RPC_URL || "",
      bundlerUrl: process.env.BUNDLER_URL || "",
      entryPoint: process.env.ENTRYPOINT || "",
      router: process.env.ROUTER || "",
      paymaster: process.env.PAYMASTER || "",
      factory: process.env.FACTORY || "",
      feeVault: process.env.FEEVAULT || "",
      usdc: process.env.USDC || "",
      permit2: process.env.PERMIT2 || "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    lane: { selectedLane: "", reasons: [], warnings: [] },
    ownerSender: { ownerAddress: "", senderAddress: "", senderDeployed: false, ownerEthBalWei: "" },
    stipend: { stipendTriggered: false, stipendReason: "", stipendUserOpHash: "", stipendTxHash: "" },
    permit2Setup: {
      needsTokenApprove: false,
      needsPermit2Approve: false,
      tokenApproveTxHash: "",
      permit2ApproveTxHash: "",
      setupRetried: false,
    },
    paymasterQuote: { quotedFeeToken: "", quotedFeeAmount: "", quotedMode: 0, quoteRaw: null },
    userOp: { userOpHash: "", bundlerRpc: process.env.BUNDLER_URL || "", estimateUsed: false, txHash: "", success: false },
    receipt: { success: false, transactionHash: "", transfers: { toAmount: "", feeAmount: "" }, raw: null },
    resumeUserOpHash,
    receiptOnly,
    status: "",
    txHash: null,
    success: false,
    error: null,
    owner_eoa: "",
  };

  const bundlerUrl = requireEnv("BUNDLER_URL");
  bundlerUrlGlobal = bundlerUrl;
  const feeVault = requireEnv("FEEVAULT");
  const permit2Address = requireEnv("PERMIT2", "0x000000000022D473030F116dDEE9F6B43aC78BA3");

  const token = requireEnv("TOKEN");
  const to = requireEnv("TO");
  const eip3009Tokens = new Set();
  const addEip3009Token = (addr) => {
    const trimmed = String(addr || "").trim();
    if (!trimmed) return;
    eip3009Tokens.add(toLower(trimmed));
  };
  const eip3009List = String(process.env.EIP3009_TOKENS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const addr of eip3009List) addEip3009Token(addr);
  addEip3009Token(process.env.USDC);
  addEip3009Token(process.env.EURC);
  const eip2612Tokens = new Set();
  const addEip2612Token = (addr) => {
    const trimmed = String(addr || "").trim();
    if (!trimmed) return;
    eip2612Tokens.add(toLower(trimmed));
  };
  const eip2612List = String(process.env.EIP2612_TOKENS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const addr of eip2612List) addEip2612Token(addr);
  addEip2612Token(process.env.AERO);
  if (resumeUserOpHash || receiptOnly) {
    const lane = "RESUME";
    const feeModeEnv = String(process.env.FEE_MODE ?? "eco");
    const feeTokenMode = String(process.env.FEE_TOKEN_MODE ?? "same");
    const userOpHash = resumeUserOpHash;
    emitUx("UX_START", { resumeUserOpHash, receiptOnly: true });
    if (!resumeUserOpHash) {
      throw new Error("Missing resume userOp hash");
    }
    const receipt = await waitForUserOpReceipt(resumeUserOpHash);
    if (!receipt) {
      result.status = "PENDING";
      result.txHash = null;
      result.receipt.success = null;
      return result;
    }
    const txHash = receipt.receipt?.transactionHash || "";
    emitUx("RECEIPT_CONFIRMED", { userOpHash: resumeUserOpHash, txHash, success: receipt.success });
    result.status = "CONFIRMED";
    result.txHash = txHash;
    const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
    emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
    if (receipt.success) {
      const netAmountResult = toAmount || "0";
      const feeAmountResult = feeAmount || "0";
      emitUx("USER_RESULT", {
        token,
        to,
        netAmount: netAmountResult,
        feeAmount: feeAmountResult,
        feeVault,
        txHash,
        userOpHash,
        feeMode: feeModeEnv,
        feeTokenMode,
        lane,
      });
    }
    result.receipt = {
      success: !!receipt.success,
      transactionHash: txHash,
      transfers: { toAmount, feeAmount },
      raw: receipt,
    };
    result.userOp.userOpHash = resumeUserOpHash;
    result.userOp.success = !!receipt.success;
    result.userOp.txHash = txHash;
    result.success = !!receipt.success;
    return result;
  }

  const rpcUrl = requireEnv("RPC_URL");
  const entryPoint = requireEnv("ENTRYPOINT");
  const router = requireEnv("ROUTER");
  const paymaster = requireEnv("PAYMASTER");
  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);

  const amount = BigInt(requireEnv("AMOUNT"));
  const payGasYourself = parseBoolEnv("PAY_GAS_YOURSELF", "0");

  const ownerEoaEnv = (process.env.OWNER_EOA || "").trim();
  let ownerEoaResolved = ownerEoaEnv;
  if (!ownerEoaResolved) {
    const pkForOwner = (process.env.PRIVATE_KEY_TEST_USER || "").trim();
    if (pkForOwner) {
      try {
        ownerEoaResolved = new ethers.Wallet(pkForOwner).address;
      } catch {
        ownerEoaResolved = "";
      }
    }
  }
  const ownerEoaLower = ownerEoaResolved ? toLower(ownerEoaResolved) : "";
  result.owner_eoa = ownerEoaLower;

  const feeModeRaw = String(process.env.FEE_MODE ?? "eco");
  const feeMode = parseFeeMode(feeModeRaw);
  const speed = feeMode; // 0=eco, 1=instant
  emitUx("UX_START", { token, to, amount: amount.toString(), feeMode: feeModeRaw, speed });

  // === SELF PAY MODE EARLY SHORT-CIRCUIT ===
  if (process.env.PAY_GAS_YOURSELF === "1") {
    const lane = "SELF_PAY";
    result.lane.selectedLane = lane;
    result.lane.reasons.push("SELF_PAY");
    result.paymasterQuote = null;
    const ownerEoa = ownerEoaResolved;
    const ownerPk = (process.env.OWNER_PK || process.env.PRIVATE_KEY_TEST_USER || "").trim();
    let ownerAddress = ownerEoa;
    if (ownerPk) {
      try {
        ownerAddress = new ethers.Wallet(ownerPk).address;
      } catch {
        ownerAddress = ownerEoa;
      }
    }
    const ownerEthBalWei = ownerAddress ? await publicRpc.getBalance(ownerAddress) : 0n;
    result.ownerSender.ownerAddress = ownerAddress;
    result.ownerSender.ownerEthBalWei = ownerEthBalWei.toString();
    result.transfers = { toAmount: amount.toString(), feeAmount: "0" };
    result.receipt = {
      success: false,
      transactionHash: "",
      transfers: { toAmount: amount.toString(), feeAmount: "0" },
    };
    const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
    const tokenContract = new ethers.Contract(token, erc20Abi, publicRpc);
    const ownerTokenBal = ownerAddress ? await tokenContract.balanceOf(ownerAddress) : 0n;
    if (BigInt(ownerTokenBal) < amount) {
      const shortfallWei = (amount - BigInt(ownerTokenBal)).toString();
      emitUx("INSUFFICIENT_TOKEN_BALANCE_SELF_PAY", {
        token,
        owner: ownerAddress,
        needWei: amount.toString(),
        haveWei: ownerTokenBal.toString(),
        shortfallWei,
      });
      const gasEstimate = await estimateSelfPayGasFallback(publicRpc);
      emitUx("NETWORK_GAS_ESTIMATE_FALLBACK", gasEstimate);
      result.status = "FAILED";
      result.success = false;
      result.txHash = null;
      result.networkGasEstimate = gasEstimate;
      result.error = {
        name: "INSUFFICIENT_BALANCE",
        message: `INSUFFICIENT_TOKEN_BALANCE_SELF_PAY: need ${amount} have ${ownerTokenBal}`,
        needWei: amount.toString(),
        haveWei: ownerTokenBal.toString(),
        shortfallWei,
      };
      return result;
    }
    emitUx("USER_SUMMARY", {
      token,
      amount: amount.toString(),
      feeTokenAmount: "0",
      netAmount: amount.toString(),
      feeUsd6: "0",
      feeTokenMode: "same",
      feeMode: feeModeRaw,
      sponsored: false,
      lane,
      owner_eoa: ownerEoaLower,
    });
    const jsonOutPath = options.jsonOutPath || "out/orchestrate_last.json";
    const childJsonPath = jsonOutPath.endsWith(".json") ? `${jsonOutPath}.selfpay` : `${jsonOutPath}.selfpay.json`;
    const res = spawnSync("node", ["scripts/aa/send_selfpay_v5.mjs", "--json-out", childJsonPath], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, SPEED: String(process.env.SPEED ?? "0") },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    let child = null;
    try {
      const raw = fs.readFileSync(childJsonPath, "utf8");
      child = JSON.parse(raw);
    } catch {
      child = null;
    }
    const txHash = child?.txHash || child?.receipt?.transactionHash || "";
    const toAmount = child?.receipt?.transfers?.toAmount || amount.toString();
    const feeAmount = child?.receipt?.transfers?.feeAmount || child?.transfers?.feeAmount || "0";
    emitUx("TRANSFERS_DECODED", { toAmount, feeAmount: "0" });
    emitUx("USER_RESULT", {
      token,
      to,
      netAmount: toAmount,
      feeAmount,
      feeVault,
      txHash,
      userOpHash: "",
      feeMode: feeModeRaw,
      feeTokenMode: "same",
      lane,
    });
    const selfpaySuccess = !!child?.success && res.status === 0;
    result.status = selfpaySuccess ? "CONFIRMED" : "FAILED";
    result.txHash = txHash || null;
    result.success = selfpaySuccess;
    result.userOp = { ...result.userOp, txHash: "" };
    result.receipt = child?.receipt || {
      success: selfpaySuccess,
      transactionHash: txHash,
      transfers: { toAmount, feeAmount },
    };
    result.transfers = child?.transfers || { toAmount, feeAmount };
    result.networkGasEstimate = child?.gasEstimate || result.networkGasEstimate || null;
    result.error = child?.error || null;
    return result;
  }

  const ownerEoa = ownerEoaResolved;
  const ownerPk = (process.env.OWNER_PK || process.env.PRIVATE_KEY_TEST_USER || "").trim();
  const aaOwnerPk = (process.env.PRIVATE_KEY_TEST_USER || ownerPk || "").trim();

  const preferPermit2 = parseBoolEnv("PREFER_PERMIT2", "0");
  const autoSetupPermit2 = parseBoolEnv("AUTO_SETUP_PERMIT2", "0");
  const autoSetupAaApprove = parseBoolEnv("AUTO_SETUP_AA_APPROVE", "0");
  const autoStipendPermit2 = parseBoolEnv("AUTO_STIPEND_PERMIT2", "0");
  const minOwnerEthWei = BigInt(process.env.MIN_OWNER_ETH_WEI ?? "200000000000000");

  const factoryAddr = requireEnv("FACTORY");
  const factoryAbi = ["function getAddress(address owner, uint256 salt) view returns (address)"];
  const factory = new ethers.Contract(factoryAddr, factoryAbi, publicRpc);

  if (!aaOwnerPk) {
    result.lane.selectedLane = "NONE";
    result.lane.reasons.push("MISSING_PRIVATE_KEY_TEST_USER");
    console.log("LANE=NONE");
    console.log("REASON=MISSING_PRIVATE_KEY_TEST_USER");
    return result;
  }

  const aaWallet = new ethers.Wallet(aaOwnerPk);
  const aaOwner = aaWallet.address;
  const sender = await factory["getAddress(address,uint256)"](aaOwner, 0n);
  const senderCode = await publicRpc.getCode(sender);
  const senderDeployed = typeof senderCode === "string" && senderCode !== "0x";
  console.log(`SENDER=${sender}`);
  console.log(`SENDER_DEPLOYED=${senderDeployed ? "true" : "false"}`);
  result.ownerSender.senderAddress = sender;
  result.ownerSender.senderDeployed = senderDeployed;
  result.ownerSender.ownerAddress = ownerEoa;

  let ownerEthBalWei = ownerEoa ? await publicRpc.getBalance(ownerEoa) : 0n;
  console.log(`OWNER_ETH_BAL_WEI=${ownerEthBalWei}`);
  emitUx("OWNER_CHECK", { ownerEthBalWei: ownerEthBalWei.toString() });
  result.ownerSender.ownerEthBalWei = ownerEthBalWei.toString();

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)",
  ];
  const tokenContract = new ethers.Contract(token, erc20Abi, publicRpc);

  const ownerBal = ownerEoa ? await tokenContract.balanceOf(ownerEoa) : 0n;
  const senderBal = await tokenContract.balanceOf(sender);
  const isEip3009Token = eip3009Tokens.has(toLower(token));
  const mustUseEip3009 = Boolean(isEip3009Token && ownerEoa && BigInt(ownerBal) >= amount);
  const isEip2612Token = eip2612Tokens.has(toLower(token));
  const mustUseEip2612 = Boolean(isEip2612Token && ownerEoa && BigInt(ownerBal) >= amount);

  console.log(`OWNER_TOKEN_BAL=${BigInt(ownerBal)}`);
  console.log(`SENDER_TOKEN_BAL=${BigInt(senderBal)}`);

  const feeModeEnv = String(process.env.FEE_MODE ?? "eco");
  const feeModeLocal = parseFeeMode(feeModeEnv);
  let feeTokenMode = "same";
  let feeTokenAddress = token;
  let effectiveFeeTokenMode = "same";
  let effectiveFeeTokenAddress = token;
  let effectiveFeeTokenDecimals = 18;
  let effectiveFeeTokenSymbol = token.toLowerCase() === "0x4200000000000000000000000000000000000006" ? "WETH" : "ERC20";
  const paymasterAbi = [
    "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
    "function feeTokenDecimals(address token) view returns (uint8)",
    "function usd6PerWholeToken(address token) view returns (uint256)",
  ];
  const paymasterContract = new ethers.Contract(paymaster, paymasterAbi, publicRpc);
  let quoteRaw;
  let quotedFeeUsd6;
  let maxFeeUsd6;
  let feeInfo;
  let finalFeeTokenAmount;
  let netAmount;
  let lane = "UNDECIDED";
  let reason = "";

  if (payGasYourself) {
    lane = "SELF_PAY";
    result.lane.selectedLane = lane;
    result.lane.reasons.push("SELF_PAY");
    emitUx("USER_SUMMARY", {
      token,
      amount: amount.toString(),
      feeTokenAmount: "0",
      netAmount: amount.toString(),
      feeUsd6: "0",
      feeTokenMode: "same",
      feeMode: feeModeEnv,
      sponsored: false,
      lane,
      owner_eoa: ownerEoaLower,
    });
    const res = spawnSync("node", ["scripts/aa/send_selfpay_v5.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: {
        ...process.env,
        SPEED: String(process.env.SPEED ?? "0"),
      },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    const txHashMatch = String(res.stdout || "").match(/RECEIPT_TX=([0x0-9a-fA-F]+)/);
    const txHash = txHashMatch ? txHashMatch[1] : "";
    const transferMatch = String(res.stdout || "").match(/TRANSFER_TO=(\d+)/);
    const transferTo = transferMatch ? transferMatch[1] : amount.toString();
    emitUx("TRANSFERS_DECODED", { toAmount: transferTo, feeAmount: "0" });
    emitUx("USER_RESULT", {
      token,
      to,
      netAmount: transferTo,
      feeAmount: "0",
      feeVault,
      txHash,
      userOpHash: "",
      feeMode: feeModeEnv,
      feeTokenMode: "same",
      lane,
    });
    result.status = res.status === 0 ? "CONFIRMED" : "FAILED";
    result.txHash = txHash || null;
    result.success = res.status === 0;
    return result;
  }

  while (true) {
    const nowTs = Math.floor(Date.now() / 1000);
    quoteRaw = await paymasterContract.quoteFeeUsd6(sender, 0, feeModeLocal, nowTs);
    quotedFeeUsd6 = BigInt(quoteRaw[2]);
    maxFeeUsd6 = BigInt(quoteRaw[4]);
    feeInfo = await computeFinalFeeTokenAmount(paymasterContract, sender, feeTokenAddress, feeModeLocal, nowTs);
    finalFeeTokenAmount = BigInt(feeInfo.finalFeeTokenAmount);
    netAmount = amount - finalFeeTokenAmount;
    effectiveFeeTokenDecimals = Number(feeInfo.decimals);

    if (finalFeeTokenAmount >= amount) {
      emitUx("FEE_TOO_HIGH", {
        token,
        amount: amount.toString(),
        feeTokenAmount: finalFeeTokenAmount.toString(),
        laneCandidate: lane || "UNDECIDED",
      });
      throw new Error(
        `FEE_TOO_HIGH: feeTokenAmount (${finalFeeTokenAmount}) >= amount (${amount}). Increase amount or switch SELF_PAY.`
      );
    }

    result.paymasterQuote = {
      quotedFeeToken: feeTokenAddress,
      quotedFeeAmount: quotedFeeUsd6.toString(),
      quotedMode: 0,
      quoteRaw,
    };
    emitUx("QUOTE_RECEIVED", {
      feeUsd6: feeInfo.totalUsd6.toString(),
      feeTokenAmount: finalFeeTokenAmount.toString(),
      feeMode: feeModeEnv,
      speed: feeModeLocal,
      mode: 0,
    });

    console.log(`FEE_USD6=${feeInfo.totalUsd6.toString()}`);
    console.log(`FEE_TOKEN_AMOUNT=${finalFeeTokenAmount.toString()}`);
    console.log(`EXPECTED_NET=${netAmount}`);

    if (netAmount <= 0n) {
      const minAmount = finalFeeTokenAmount + 1n;
      const displayTokenLower = token.toLowerCase();
      const symbol = displayTokenLower === "0x4200000000000000000000000000000000000006" ? "WETH" : "ERC20";
      const displayDecimals = effectiveFeeTokenDecimals;
      const feeUsd = (Number(feeInfo.totalUsd6) / 1e6).toString();
      const recommendedAction = "INCREASE_AMOUNT";
      const minAmountUi = ethers.formatUnits(minAmount, displayDecimals);
      const shortfallUi = ethers.formatUnits(minAmount - amount, displayDecimals);
      const messageTitle = "Amount too small";
      const messageBody = `You need at least ${minAmountUi} ${symbol} to cover the ${feeUsd} USD fee. Add ${shortfallUi} ${symbol} more.`;
      const amountTooSmallPayload = {
        token,
        amount: amount.toString(),
        feeTokenAmount: finalFeeTokenAmount.toString(),
        netAmount: netAmount.toString(),
        minAmount: minAmount.toString(),
        shortfall: (minAmount - amount).toString(),
        decimals: String(displayDecimals),
        minAmountUi,
        shortfallUi,
        suggestedAmount: minAmount.toString(),
        suggestedAmountUi: minAmountUi,
        symbol,
        messageTitle,
        messageBody,
        feeUsd6: feeInfo.totalUsd6.toString(),
        feeTokenMode,
        feeMode: feeModeEnv,
        canSwitchFeeTokenMode: false,
        recommendedAction,
        sponsored: true,
        lane: lane || "UNDECIDED",
      };
      amountTooSmallPayload.nextStep = "SET_AMOUNT_AND_REQUOTE";
      amountTooSmallPayload.setAmountWei = minAmount.toString();
      amountTooSmallPayload.setAmountUi = minAmountUi;
      emitUx("AMOUNT_TOO_SMALL", amountTooSmallPayload);

      result.status = "AMOUNT_TOO_SMALL";
      result.success = false;
      console.log("EXIT_REASON=AMOUNT_TOO_SMALL", "feeTokenMode=", feeTokenMode);
      return result;
    }

    break;
  }

  if (feeTokenMode === "same" && finalFeeTokenAmount > amount) {
    result.lane.selectedLane = "NONE";
    result.lane.reasons.push("AMOUNT_TOO_SMALL_FOR_FEE");
    console.log("LANE=NONE");
    console.log("REASON=AMOUNT_TOO_SMALL_FOR_FEE");
    console.log("NEXT=Increase AMOUNT above fee");
    console.log("EXIT_REASON=AMOUNT_TOO_SMALL_FOR_FEE", "feeTokenMode=", feeTokenMode);
    return result;
  }

  lane = "NONE";

  if (ownerEoa && isEip3009Token && BigInt(ownerBal) >= amount) {
    lane = "EIP3009";
    reason = "EIP3009_SUPPORTED_TOKEN";
  } else if (ownerEoa && isEip2612Token && BigInt(ownerBal) >= amount) {
    lane = "EIP2612";
    reason = "EIP2612_SUPPORTED_TOKEN";
  } else if (preferPermit2 && ownerEoa && BigInt(ownerBal) >= amount) {
    lane = "PERMIT2";
    reason = "PREFER_PERMIT2";
  } else if (BigInt(senderBal) >= amount) {
    lane = "AA";
    reason = "SENDER_HAS_FUNDS";
  } else if (ownerEoa && BigInt(ownerBal) >= amount) {
    lane = "PERMIT2";
    reason = "OWNER_HAS_FUNDS";
  } else {
    lane = "NONE";
    reason = "INSUFFICIENT_BALANCE";
  }

  console.log(`PREFER_PERMIT2=${preferPermit2 ? "1" : "0"}`);
  console.log(`LANE=${lane}`);
  console.log(`REASON=${reason}`);

  result.lane.selectedLane = lane;
  result.lane.reasons.push(reason);

  if (mustUseEip3009 && lane !== "EIP3009") {
    throw new Error(`CANONICAL_VIOLATION: EIP3009 token must use EIP3009 lane but got ${lane}`);
  }
  if (mustUseEip2612 && lane !== "EIP2612") {
    throw new Error(`CANONICAL_VIOLATION: EIP2612 token must use EIP2612 lane but got ${lane}`);
  }

  if (lane === "NONE") {
    if (!ownerEoa) {
      result.lane.reasons.push("MISSING_OWNER_EOA");
      console.log("REASON=MISSING_OWNER_EOA");
    }
    return result;
  }

  const setupTxs = [];
  let tokenApproveTxHash = "none";
  let permit2ApproveTxHash = "none";
  let stipendUserOpHash = "none";
  let userOpHash = "";

  const maybeRunPermit2Stipend = async (reasonText) => {
    if (mustUseEip3009) {
      throw new Error("CANONICAL_VIOLATION: stipend forbidden for EIP3009 tokens");
    }
    if (mustUseEip2612) {
      throw new Error("CANONICAL_VIOLATION: stipend forbidden for EIP2612 tokens");
    }
    if (!autoStipendPermit2) {
      console.log("STIPEND_TRIGGERED=false");
      return false;
    }
    if (!process.env.STIPEND_SIGNER_PRIVATE_KEY) {
      result.lane.reasons.push("NEEDS_STIPEND_SIGNER_PRIVATE_KEY");
      console.log("NEEDS_SETUP=STIPEND_SIGNER_PRIVATE_KEY");
      console.log("STIPEND_TRIGGERED=false");
      return false;
    }
    const bal = await publicRpc.getBalance(ownerEoa);
    console.log(`OWNER_ETH_BAL_WEI=${bal}`);
    emitUx("OWNER_CHECK", { ownerEthBalWei: bal.toString() });
    if (BigInt(bal) >= minOwnerEthWei) {
      console.log("STIPEND_TRIGGERED=false");
      return true;
    }
    console.log(`STIPEND_REASON=${reasonText}`);
    emitUx("STIPEND_REQUESTED", { reason: reasonText });
    const res = spawnSync("node", ["scripts/aa/activate_permit2_stipend_v5.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    const stipendHash = extractStipendUserOpHash(res.stdout || "");
    if (!stipendHash) {
      result.lane.reasons.push("STIPEND_FAILED");
      return false;
    }
    stipendUserOpHash = stipendHash;
    console.log(`STIPEND_USEROP_HASH=${stipendHash}`);
    result.stipend.stipendUserOpHash = stipendHash;
    console.log("STIPEND_TRIGGERED=true");
    result.stipend.stipendTriggered = true;
    result.stipend.stipendReason = reasonText;
    emitUx("STIPEND_SUBMITTED", { userOpHash: stipendHash });

    const stipendReceipt = await waitForUserOpReceipt(stipendHash);
    if (!stipendReceipt) {
      result.status = "PENDING_STIPEND";
      result.lane.reasons.push("PENDING_STIPEND");
      return false;
    }
    const stipendTxHash = stipendReceipt.receipt?.transactionHash || "";
    const stipendBlockNumber = stipendReceipt.receipt?.blockNumber;
    const stipendBlockTag = stipendBlockNumber ?? "latest";
    emitUx("STIPEND_CONFIRMED", {
      userOpHash: stipendHash,
      txHash: stipendTxHash,
      success: stipendReceipt.success,
      blockNumber: stipendBlockNumber ?? "",
    });

    if (!stipendReceipt.success) {
      result.lane.reasons.push("STIPEND_FAILED");
      return false;
    }

    const balAt = await publicRpc.getBalance(ownerEoa, stipendBlockTag);
    console.log(`OWNER_ETH_BAL_WEI=${balAt}`);
    emitUx("OWNER_CHECK", { ownerEthBalWei: balAt.toString() });
    return BigInt(balAt) >= minOwnerEthWei;
  };

  if (lane === "EIP3009") {
    if (!ownerEoa) {
      result.lane.reasons.push("MISSING_OWNER_EOA");
      console.log("LANE=NONE");
      console.log("REASON=MISSING_OWNER_EOA");
      return result;
    }

    if (BigInt(ownerBal) < amount) {
      result.lane.reasons.push("INSUFFICIENT_OWNER_BALANCE");
      console.log("LANE=NONE");
      console.log("REASON=INSUFFICIENT_OWNER_BALANCE");
      return result;
    }

    console.log(`USING_FINAL_FEE=${finalFeeTokenAmount} (source=paymaster_quote)`);
    emitUx("USER_SUMMARY", {
      token,
      amount: amount.toString(),
      feeTokenAmount: finalFeeTokenAmount.toString(),
      netAmount: netAmount.toString(),
      feeUsd6: feeInfo.totalUsd6.toString(),
      feeTokenMode: "same",
      feeMode: feeModeEnv,
      sponsored: true,
      lane,
      owner_eoa: ownerEoaLower,
    });
    const res = spawnSync("node", ["scripts/aa/send_eip3009_v5.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: {
        ...process.env,
        FINAL_FEE_TOKEN: String(finalFeeTokenAmount),
        MAX_FEE_USD6: String(maxFeeUsd6),
        MAX_FEE_USDC6: String(maxFeeUsd6),
        SPEED: String(feeModeLocal),
        FEE_MODE: feeModeEnv,
        FEE_TOKEN_MODE: "same",
        FEE_TOKEN_ADDRESS: token,
      },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    userOpHash = extractUserOpHash(res.stdout || "");
    result.userOp.userOpHash = userOpHash;
    if (userOpHash) emitUx("SEND_SUBMITTED", { userOpHash, lane: "EIP3009" });
    result.status = "SUBMITTED";
    const receipt = userOpHash ? await waitForUserOpReceipt(userOpHash) : null;
    if (!receipt) {
      result.status = "PENDING";
      result.txHash = null;
      return result;
    }
    const txHash = receipt.receipt?.transactionHash || "";
    emitUx("RECEIPT_CONFIRMED", { userOpHash, txHash, success: receipt.success });
    result.status = "CONFIRMED";
    result.txHash = txHash;
    const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
    console.log(`RECEIPT_SUCCESS=${receipt.success}`);
    console.log(`RECEIPT_TX=${txHash}`);
    console.log(`TRANSFER_TO=${toAmount}`);
    console.log(`TRANSFER_FEE=${feeAmount}`);
    emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
    if (receipt.success) {
      const netAmountResult = toAmount || netAmount.toString();
      const feeAmountResult = feeAmount || finalFeeTokenAmount.toString();
      emitUx("USER_RESULT", {
        token,
        to,
        netAmount: netAmountResult,
        feeAmount: feeAmountResult,
        feeVault,
        txHash,
        userOpHash,
        feeMode: feeModeEnv,
        feeTokenMode: "same",
        lane,
      });
    }
    result.receipt = {
      success: !!receipt.success,
      transactionHash: txHash,
      transfers: { toAmount, feeAmount },
      raw: receipt,
    };
    result.userOp.success = !!receipt.success;
    result.userOp.txHash = txHash;
  }

  if (lane === "EIP2612") {
    if (!ownerEoa) {
      result.lane.reasons.push("MISSING_OWNER_EOA");
      console.log("LANE=NONE");
      console.log("REASON=MISSING_OWNER_EOA");
      return result;
    }

    if (BigInt(ownerBal) < amount) {
      result.lane.reasons.push("INSUFFICIENT_OWNER_BALANCE");
      console.log("LANE=NONE");
      console.log("REASON=INSUFFICIENT_OWNER_BALANCE");
      return result;
    }

    console.log(`USING_FINAL_FEE=${finalFeeTokenAmount} (source=paymaster_quote)`);
    emitUx("USER_SUMMARY", {
      token,
      amount: amount.toString(),
      feeTokenAmount: finalFeeTokenAmount.toString(),
      netAmount: netAmount.toString(),
      feeUsd6: feeInfo.totalUsd6.toString(),
      feeTokenMode: "same",
      feeMode: feeModeEnv,
      sponsored: true,
      lane,
      owner_eoa: ownerEoaLower,
    });
    const res = spawnSync("node", ["scripts/aa/send_eip2612_v5.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: {
        ...process.env,
        FINAL_FEE_TOKEN: String(finalFeeTokenAmount),
        MAX_FEE_USD6: String(maxFeeUsd6),
        MAX_FEE_USDC6: String(maxFeeUsd6),
        SPEED: String(feeModeLocal),
        FEE_TOKEN_MODE: "same",
        FEE_TOKEN_ADDRESS: token,
      },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    userOpHash = extractUserOpHash(res.stdout || "");
    result.userOp.userOpHash = userOpHash;
    if (userOpHash) emitUx("SEND_SUBMITTED", { userOpHash, lane: "EIP2612" });
    result.status = "SUBMITTED";
    const receipt = userOpHash ? await waitForUserOpReceipt(userOpHash) : null;
    if (!receipt) {
      result.status = "PENDING";
      result.txHash = null;
      return result;
    }
    const txHash = receipt.receipt?.transactionHash || "";
    emitUx("RECEIPT_CONFIRMED", { userOpHash, txHash, success: receipt.success });
    result.status = "CONFIRMED";
    result.txHash = txHash;
    const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
    console.log(`RECEIPT_SUCCESS=${receipt.success}`);
    console.log(`RECEIPT_TX=${txHash}`);
    console.log(`TRANSFER_TO=${toAmount}`);
    console.log(`TRANSFER_FEE=${feeAmount}`);
    emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
    if (receipt.success) {
      const netAmountResult = toAmount || netAmount.toString();
      const feeAmountResult = feeAmount || finalFeeTokenAmount.toString();
      emitUx("USER_RESULT", {
        token,
        to,
        netAmount: netAmountResult,
        feeAmount: feeAmountResult,
        feeVault,
        txHash,
        userOpHash,
        feeMode: feeModeEnv,
        feeTokenMode: "same",
        lane,
      });
    }
    result.receipt = {
      success: !!receipt.success,
      transactionHash: txHash,
      transfers: { toAmount, feeAmount },
      raw: receipt,
    };
    result.userOp.success = !!receipt.success;
    result.userOp.txHash = txHash;
  }

  if (lane === "PERMIT2") {
    if (!ownerEoa) {
      result.lane.reasons.push("MISSING_OWNER_EOA");
      console.log("LANE=NONE");
      console.log("REASON=MISSING_OWNER_EOA");
      return result;
    }

    const maxUint160 = (1n << 160n) - 1n;
    const maxUint48 = (1n << 48n) - 1n;
    const required = amount + finalFeeTokenAmount;
    if (required > maxUint160) {
      result.lane.reasons.push("REQUIRED_EXCEEDS_UINT160");
      console.log("LANE=NONE");
      console.log("REASON=REQUIRED_EXCEEDS_UINT160");
      return result;
    }

    const allowanceErc20 = await tokenContract.allowance(ownerEoa, permit2Address);
    const permit2Abi = [
      "function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)",
      "function approve(address token,address spender,uint160 amount,uint48 expiration)",
    ];
    const permit2 = new ethers.Contract(permit2Address, permit2Abi, publicRpc);
    const [permit2Amount, permit2Exp] = await permit2.allowance(ownerEoa, token, router);

    const nowUnix = BigInt(Math.floor(Date.now() / 1000));
    const hasTokenApprove = BigInt(allowanceErc20) > 0n;
    const hasPermit2Approve = BigInt(permit2Amount) > 0n && BigInt(permit2Exp) > nowUnix;
    const needsSetup = !(hasTokenApprove && hasPermit2Approve);

    emitUx("PERMIT2_SETUP_STATUS", {
      hasTokenApprove,
      hasPermit2Approve,
      tokenAllowance: allowanceErc20.toString(),
      permit2Amount: permit2Amount.toString(),
      permit2Expiration: permit2Exp.toString(),
      needsSetup,
    });

    if (needsSetup) {
      emitUx("SETUP_REQUIRED", { type: "PERMIT2_SETUP" });

      const autoSetupPermit2 = process.env.AUTO_SETUP_PERMIT2 === "1";
      const autoStipendPermit2 = process.env.AUTO_STIPEND_PERMIT2 === "1";
      const MIN_OWNER_ETH_FOR_SETUP_WEI = BigInt(process.env.STIPEND_WEI || "120000000000000");
      const MAX_WAIT_MS = 65000;

      if (needsSetup && autoSetupPermit2 && ownerEthBalWei < MIN_OWNER_ETH_FOR_SETUP_WEI && !autoStipendPermit2) {
        emitUx("PERMIT2_STIPEND_REQUIRED_BUT_DISABLED", {
          owner: ownerEoa,
          ownerEthBalWei: ownerEthBalWei.toString(),
          targetWei: MIN_OWNER_ETH_FOR_SETUP_WEI.toString(),
        });
        throw new Error("PERMIT2_STIPEND_REQUIRED_BUT_DISABLED");
      }

      if (!autoSetupPermit2) {
        result.lane.reasons.push("PERMIT2_SETUP_REQUIRED");
        console.log("REASON=PERMIT2_SETUP_REQUIRED");
        return result;
      }

      if (needsSetup && autoSetupPermit2 && autoStipendPermit2) {
        if (ownerEthBalWei < MIN_OWNER_ETH_FOR_SETUP_WEI) {
          emitUx("PERMIT2_STIPEND_BEFORE_SETUP", { ownerEthBalWei: ownerEthBalWei.toString() });
          const stipendRes = spawnSync("node", ["scripts/aa/activate_permit2_stipend_v5.mjs"], {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            env: { ...process.env },
          });
          if (stipendRes.stdout) process.stdout.write(stipendRes.stdout);
          if (stipendRes.stderr) process.stderr.write(stipendRes.stderr);
          if (stipendRes.status !== 0) {
            const outText = String(stipendRes.stdout || "");
            const errText = String(stipendRes.stderr || "");
            const tailLines = `${outText}\n${errText}`
              .split(/\r?\n/)
              .filter(Boolean)
              .slice(-6)
              .join("\n");
            console.error("ERROR=PERMIT2_STIPEND_FAILED");
            if (tailLines) console.error(tailLines);
            process.exit(1);
          }

          const stdoutText = String(stipendRes.stdout || "");
          const patterns = [
            /ACTIVATE_STIPEND_USEROP_HASH=(0x[0-9a-fA-F]{64})/,
            /TX_SENT_USEROP=(0x[0-9a-fA-F]{64})/,
            /USEROP_HASH=(0x[0-9a-fA-F]{64})/,
          ];
          for (const pattern of patterns) {
            const match = stdoutText.match(pattern);
            if (match) {
              stipendUserOpHash = match[1];
              break;
            }
          }

          emitUx("PERMIT2_STIPEND_WAIT_START", {
            owner: ownerEoa,
            targetWei: MIN_OWNER_ETH_FOR_SETUP_WEI.toString(),
            timeoutMs: String(MAX_WAIT_MS),
            stipendUserOpHash: stipendUserOpHash || "",
          });
          ownerEthBalWei = await waitForStipendSettlement({
            provider: publicRpc,
            owner: ownerEoa,
            targetWei: MIN_OWNER_ETH_FOR_SETUP_WEI,
            timeoutMs: MAX_WAIT_MS,
            stipendUserOpHash: stipendUserOpHash || "",
          });
          emitUx("OWNER_BAL_AFTER_STIPEND", { ownerEthBalWei: ownerEthBalWei.toString() });
          result.ownerSender.ownerEthBalWei = ownerEthBalWei.toString();
        } else {
          emitUx("PERMIT2_STIPEND_SKIP", { ownerEthBalWei: ownerEthBalWei.toString() });
        }
      }

      const setupJsonPath = "out/permit2_setup_last.json";
      const res = spawnSync("node", ["scripts/aa/activate_permit2_setup_v5.mjs", "--token", token, "--json-out", setupJsonPath], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env: { ...process.env },
      });
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      if (res.status !== 0) {
        result.lane.reasons.push("PERMIT2_SETUP_FAILED");
        return result;
      }

      try {
        const raw = fs.readFileSync(setupJsonPath, "utf8");
        const parsed = JSON.parse(raw);
        tokenApproveTxHash = parsed?.tokenApproveTxHash || tokenApproveTxHash;
        permit2ApproveTxHash = parsed?.permit2ApproveTxHash || permit2ApproveTxHash;
      } catch {
        // ignore json read errors
      }

      let allowanceErc20After = 0n;
      let permit2AmountAfter = 0n;
      let permit2ExpAfter = 0n;
      let hasTokenApproveAfter = false;
      let hasPermit2ApproveAfter = false;
      let blockTag = undefined;
      try {
        if (tokenApproveTxHash && tokenApproveTxHash !== "none") {
          const tx = await publicRpc.getTransactionReceipt(tokenApproveTxHash);
          if (tx?.blockNumber != null) blockTag = tx.blockNumber;
        }
        if (permit2ApproveTxHash && permit2ApproveTxHash !== "none") {
          const tx = await publicRpc.getTransactionReceipt(permit2ApproveTxHash);
          if (tx?.blockNumber != null) blockTag = Math.max(blockTag ?? 0, tx.blockNumber);
        }
      } catch {
        blockTag = undefined;
      }

      for (let i = 0; i < 5; i += 1) {
        try {
          allowanceErc20After = await tokenContract.allowance(ownerEoa, permit2Address, { blockTag });
        } catch {
          blockTag = undefined;
          allowanceErc20After = await tokenContract.allowance(ownerEoa, permit2Address);
        }
        try {
          [permit2AmountAfter, permit2ExpAfter] = await permit2.allowance(ownerEoa, token, router, { blockTag });
        } catch {
          blockTag = undefined;
          [permit2AmountAfter, permit2ExpAfter] = await permit2.allowance(ownerEoa, token, router);
        }
        hasTokenApproveAfter = BigInt(allowanceErc20After) > 0n;
        hasPermit2ApproveAfter =
          BigInt(permit2AmountAfter) > 0n && BigInt(permit2ExpAfter) > BigInt(Math.floor(Date.now() / 1000));
        if (hasTokenApproveAfter && hasPermit2ApproveAfter) break;
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (!(hasTokenApproveAfter && hasPermit2ApproveAfter)) {
        result.lane.reasons.push("PERMIT2_ALLOWANCE_STILL_LOW");
        console.log("REASON=PERMIT2_ALLOWANCE_STILL_LOW");
        return result;
      }
    }

    console.log(`USING_FINAL_FEE=${finalFeeTokenAmount} (source=paymaster_quote)`);
    console.log("EFFECTIVE_FEE_TOKEN_MODE=", effectiveFeeTokenMode, "EFFECTIVE_FEE_TOKEN=", effectiveFeeTokenAddress);
    emitUx("USER_SUMMARY", {
      token,
      amount: amount.toString(),
      feeTokenAmount: finalFeeTokenAmount.toString(),
      netAmount: netAmount.toString(),
      feeUsd6: feeInfo.totalUsd6.toString(),
      feeTokenMode: effectiveFeeTokenMode,
      feeMode: feeModeEnv,
      sponsored: true,
      lane,
      owner_eoa: ownerEoaLower,
    });
    const res = spawnSync("node", ["scripts/aa/send_permit2_v5.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: {
        ...process.env,
        FINAL_FEE_TOKEN: String(finalFeeTokenAmount),
        MAX_FEE_USD6: String(maxFeeUsd6),
        SPEED: String(feeModeLocal),
        FEE_MODE: feeModeEnv,
        FEE_TOKEN_MODE: effectiveFeeTokenMode,
        FEE_TOKEN_ADDRESS: effectiveFeeTokenAddress,
      },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    userOpHash = extractUserOpHash(res.stdout || "");
    result.userOp.userOpHash = userOpHash;
    if (userOpHash) emitUx("SEND_SUBMITTED", { userOpHash, lane: "PERMIT2" });
    result.status = "SUBMITTED";
    const receipt = userOpHash ? await waitForUserOpReceipt(userOpHash) : null;
    if (!receipt) {
      result.status = "PENDING";
      result.txHash = null;
      return result;
    }
    const txHash = receipt.receipt?.transactionHash || "";
    emitUx("RECEIPT_CONFIRMED", { userOpHash, txHash, success: receipt.success });
    result.status = "CONFIRMED";
    result.txHash = txHash;
    const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
    console.log(`RECEIPT_SUCCESS=${receipt.success}`);
    console.log(`RECEIPT_TX=${txHash}`);
    console.log(`TRANSFER_TO=${toAmount}`);
    console.log(`TRANSFER_FEE=${feeAmount}`);
    emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
    if (receipt.success) {
      const netAmountResult = toAmount || netAmount.toString();
      const feeAmountResult = feeAmount || finalFeeTokenAmount.toString();
      emitUx("USER_RESULT", {
        token,
        to,
        netAmount: netAmountResult,
        feeAmount: feeAmountResult,
        feeVault,
        txHash,
        userOpHash,
        feeMode: feeModeEnv,
        feeTokenMode: String(process.env.FEE_TOKEN_MODE ?? "usdc"),
        lane,
      });
    }
    result.receipt = {
      success: !!receipt.success,
      transactionHash: txHash,
      transfers: { toAmount, feeAmount },
      raw: receipt,
    };
    result.userOp.success = !!receipt.success;
    result.userOp.txHash = txHash;
  }

  if (lane === "AA") {
    const allowanceAa = await tokenContract.allowance(sender, router);
    if (BigInt(allowanceAa) < amount) {
      if (!autoSetupAaApprove) {
        result.lane.reasons.push("NEEDS_AA_APPROVE");
        console.log("NEEDS_SETUP=AA_APPROVE");
        console.log("NEXT=Run scripts/aa/activate_approve_v5.mjs");
        return result;
      }
      emitUx("SETUP_REQUIRED", { type: "AA_APPROVE" });
      const resApprove = spawnSync("node", ["scripts/aa/activate_approve_v5.mjs"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
      if (resApprove.stdout) process.stdout.write(resApprove.stdout);
      if (resApprove.stderr) process.stderr.write(resApprove.stderr);
      const approveHash = extractUserOpHash(resApprove.stdout || "");
      if (!approveHash) {
        result.lane.reasons.push("AA_APPROVE_FAILED");
        console.log("REASON=AA_APPROVE_FAILED");
        return result;
      }
      const approveReceipt = await waitForUserOpReceipt(approveHash);
      if (!approveReceipt?.success) {
        result.lane.reasons.push("AA_APPROVE_USEROP_FAILED");
        console.log("REASON=AA_APPROVE_USEROP_FAILED");
        return result;
      }
    }

    console.log(`USING_FINAL_FEE=${quotedFee} (source=paymaster_quote)`);
      console.log("EFFECTIVE_FEE_TOKEN_MODE=", effectiveFeeTokenMode, "EFFECTIVE_FEE_TOKEN=", effectiveFeeTokenAddress);
      emitUx("USER_SUMMARY", {
      token,
      amount: amount.toString(),
      feeTokenAmount: quotedFee.toString(),
      netAmount: netAmount.toString(),
      feeUsd6: feeInfo.totalUsd6.toString(),
        feeTokenMode: effectiveFeeTokenMode,
      feeMode: feeModeEnv,
      sponsored: true,
      lane,
      owner_eoa: ownerEoaLower,
    });
    const res = spawnSync("node", ["scripts/aa/send_v5.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, MAX_FEE_USDC6: String(quotedFee), SEND_AMOUNT_USDC6: String(amount) },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    userOpHash = extractUserOpHash(res.stdout || "");
    result.userOp.userOpHash = userOpHash;
    if (userOpHash) emitUx("SEND_SUBMITTED", { userOpHash, lane: "AA" });
    result.status = "SUBMITTED";
    const receipt = userOpHash ? await waitForUserOpReceipt(userOpHash) : null;
    if (!receipt) {
      result.status = "PENDING";
      result.txHash = null;
      return result;
    }
    const txHash = receipt.receipt?.transactionHash || "";
    emitUx("RECEIPT_CONFIRMED", { userOpHash, txHash, success: receipt.success });
    result.status = "CONFIRMED";
    result.txHash = txHash;
    const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
    console.log(`RECEIPT_SUCCESS=${receipt.success}`);
    console.log(`RECEIPT_TX=${txHash}`);
    console.log(`TRANSFER_TO=${toAmount}`);
    console.log(`TRANSFER_FEE=${feeAmount}`);
    emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
    result.receipt = {
      success: !!receipt.success,
      transactionHash: txHash,
      transfers: { toAmount, feeAmount },
      raw: receipt,
    };
    result.userOp.success = !!receipt.success;
    result.userOp.txHash = txHash;
  }

  console.log("SUMMARY");
  console.log(`LANE=${lane}`);
  console.log(`REASON=${result.lane.reasons.join("|")}`);
  console.log(`AMOUNT=${amount}`);
  console.log(`FEE=${finalFeeTokenAmount}`);
  console.log(`NET=${netAmount}`);
  console.log(`TOKEN=${token}`);
  console.log(`TO=${to}`);
  console.log(`SENDER=${sender}`);
  console.log(`OWNER_EOA=${ownerEoa || ""}`);
  console.log(`SETUP_TXS=${formatSetupTxs(tokenApproveTxHash, permit2ApproveTxHash, stipendUserOpHash)}`);
  console.log(`USEROP_HASH=${userOpHash || "none"}`);
  console.log(`TX_HASH=${result.userOp.txHash || "none"}`);

  result.success = !!result.userOp.success;
  return result;
}

async function run() {
  const { jsonOutPath, resumeUserOpHash, receiptOnly } = parseArgs(process.argv);
  const dir = path.dirname(jsonOutPath);
  fs.mkdirSync(dir, { recursive: true });
  let result = null;
  try {
    result = await main({ resumeUserOpHash, receiptOnly, jsonOutPath });
    if (result?.status === "PENDING" || result?.status === "PENDING_STIPEND") {
      emitUx("UX_DONE", { success: null, status: result.status, jsonOutPath });
      process.exitCode = 0;
    } else if (result?.status === "CONFIRMED") {
      emitUx("UX_DONE", { success: !!result?.success, status: "CONFIRMED", jsonOutPath });
    } else {
      emitUx("UX_DONE", { success: !!result?.success, jsonOutPath });
    }
  } catch (err) {
    result = result || { success: false };
    result.success = false;
    result.error = { name: err?.name || "Error", message: err?.message || String(err), stack: err?.stack };
    emitUx("UX_DONE", { success: false, jsonOutPath });
    process.exitCode = 1;
  } finally {
    try {
      const json = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
      fs.writeFileSync(jsonOutPath, json);
    } catch (err) {
      console.error(err);
      process.exitCode = 1;
    }
  }
}

run();
/*
  const nowTs = Math.floor(Date.now() / 1000);
    const quoteRaw = await paymasterContract.quoteFeeUsd6(sender, 0, feeMode, nowTs);
    const finalFeeUsd6 = quoteRaw[2];
    const quotedFee = BigInt(finalFeeUsd6);
    const netAmount = amount - quotedFee;

    result.paymasterQuote = {
      quotedFeeToken: token,
      quotedFeeAmount: quotedFee.toString(),
      quotedMode: 0,
      quoteRaw,
    };
    emitUx("QUOTE_RECEIVED", { fee: quotedFee.toString(), mode: 0 });

    console.log(`EXPECTED_FEE=${quotedFee}`);
    console.log(`EXPECTED_NET=${netAmount}`);

    if (quotedFee > amount) {
      result.lane.selectedLane = "NONE";
      result.lane.reasons.push("AMOUNT_TOO_SMALL_FOR_FEE");
      console.log("LANE=NONE");
      console.log("REASON=AMOUNT_TOO_SMALL_FOR_FEE");
      console.log("NEXT=Increase AMOUNT above fee");
      return result;
    }

    let lane = "NONE";
    let reason = "";

    if (preferPermit2 && ownerEoa && BigInt(ownerBal) >= amount) {
      lane = "PERMIT2";
      reason = "PREFER_PERMIT2";
    } else if (BigInt(senderBal) >= amount) {
      lane = "AA";
      reason = "SENDER_HAS_FUNDS";
    } else if (ownerEoa && BigInt(ownerBal) >= amount) {
      lane = "PERMIT2";
      reason = "OWNER_HAS_FUNDS";
    } else {
      lane = "NONE";
      reason = "INSUFFICIENT_BALANCE";
    }

    console.log(`PREFER_PERMIT2=${preferPermit2 ? "1" : "0"}`);
    console.log(`LANE=${lane}`);
    console.log(`REASON=${reason}`);

    result.lane.selectedLane = lane;
    result.lane.reasons.push(reason);

    if (lane === "NONE") {
      if (!ownerEoa) {
        result.lane.reasons.push("MISSING_OWNER_EOA");
        console.log("REASON=MISSING_OWNER_EOA");
      }
      return result;
    }

    const setupTxs = [];
    let tokenApproveTxHash = "";
    let permit2ApproveTxHash = "";
    let stipendUserOpHash = "";
    let userOpHash = "";
    let txHash = "";
    let stipendRan = false;

    const maybeRunPermit2Stipend = async () => {
      if (!autoStipendPermit2) {
        console.log("STIPEND_TRIGGERED=false");
        return false;
      }
      if (stipendRan) {
        console.log("STIPEND_TRIGGERED=false");
        return false;
      }
      if (!process.env.STIPEND_SIGNER_PRIVATE_KEY) {
        result.lane.reasons.push("NEEDS_STIPEND_SIGNER_PRIVATE_KEY");
        console.log("NEEDS_SETUP=STIPEND_SIGNER_PRIVATE_KEY");
        console.log("STIPEND_TRIGGERED=false");
        return false;
      }

      const bal = await publicRpc.getBalance(ownerEoa);
      console.log(`OWNER_ETH_BAL_WEI=${bal}`);
      emitUx("OWNER_CHECK", { ownerEthBalWei: bal.toString() });
      if (BigInt(bal) >= minOwnerEthWei) {
        console.log("STIPEND_TRIGGERED=false");
        return true;
      }

      console.log("STIPEND_REASON=LOW_BALANCE");
      emitUx("STIPEND_REQUESTED", { reason: "LOW_BALANCE" });
      const res = spawnSync("node", ["scripts/aa/activate_permit2_stipend_v5.mjs"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env: { ...process.env },
      });
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      const stipendHash = extractStipendUserOpHash(res.stdout || "");
      if (stipendHash) {
        console.log(`STIPEND_USEROP_HASH=${stipendHash}`);
        result.stipend.stipendUserOpHash = stipendHash;
      }
      console.log("STIPEND_TRIGGERED=true");
      result.stipend.stipendTriggered = true;
      result.stipend.stipendReason = "LOW_BALANCE";
      emitUx("STIPEND_DONE", { userOpHash: stipendHash || "" });
      stipendRan = true;
      const balAfter = await publicRpc.getBalance(ownerEoa);
      console.log(`OWNER_ETH_BAL_WEI=${balAfter}`);
      emitUx("OWNER_CHECK", { ownerEthBalWei: balAfter.toString() });
      return BigInt(balAfter) >= minOwnerEthWei;
    };

    if (lane === "PERMIT2") {
      if (!ownerEoa) {
        result.lane.reasons.push("MISSING_OWNER_EOA");
        console.log("LANE=NONE");
        console.log("REASON=MISSING_OWNER_EOA");
        return result;
      }

      const maxUint160 = (1n << 160n) - 1n;
      const maxUint48 = (1n << 48n) - 1n;
      const required = amount + quotedFee;
      if (required > maxUint160) {
        result.lane.reasons.push("REQUIRED_EXCEEDS_UINT160");
        console.log("LANE=NONE");
        console.log("REASON=REQUIRED_EXCEEDS_UINT160");
        return result;
      }

      const allowanceErc20 = await tokenContract.allowance(ownerEoa, permit2Address);
      result.permit2Setup.needsTokenApprove = BigInt(allowanceErc20) < required;

      if (result.permit2Setup.needsTokenApprove) {
        emitUx("SETUP_REQUIRED", { type: "ERC20_APPROVE_TO_PERMIT2" });
        if (!autoSetupPermit2) {
          console.log("NEEDS_SETUP=ERC20_APPROVE_TO_PERMIT2");
          console.log("NEXT=Run ERC20 approve to Permit2 (AUTO_SETUP_PERMIT2=1 to auto)");
          return result;
        }
        const hasEth = await maybeRunPermit2Stipend();
        if (!hasEth) {
          result.lane.reasons.push("NEEDS_OWNER_ETH_FOR_SETUP");
          return result;
        }
        if (!ownerPk) {
          result.lane.reasons.push("NEEDS_OWNER_PK_FOR_AUTO_SETUP");
          console.log("REASON=NEEDS_OWNER_PK_FOR_AUTO_SETUP");
          console.log("NEXT=set OWNER_PK or run manual approve");
          return result;
        }
        const ownerSigner = new ethers.Wallet(ownerPk, publicRpc);
        if (toLower(ownerSigner.address) !== toLower(ownerEoa)) {
          result.lane.reasons.push("OWNER_PK_MISMATCH");
          console.log("REASON=OWNER_PK_MISMATCH");
          return result;
        }
        const tokenWithSigner = tokenContract.connect(ownerSigner);
        try {
          const tx = await tokenWithSigner.approve(permit2Address, ethers.MaxUint256);
          setupTxs.push(tx.hash);
          result.permit2Setup.tokenApproveTxHash = tx.hash;
          emitUx("SETUP_TX_SENT", { type: "ERC20_APPROVE_TO_PERMIT2", txHash: tx.hash });
          await tx.wait(1);
        } catch (err) {
          if (isInsufficientFunds(err)) {
            result.permit2Setup.setupRetried = true;
            const toppedUp = await maybeRunPermit2Stipend();
            if (!toppedUp) {
              result.lane.reasons.push("NEEDS_OWNER_ETH_FOR_SETUP");
              return result;
            }
            const tx = await tokenWithSigner.approve(permit2Address, ethers.MaxUint256);
            setupTxs.push(tx.hash);
            result.permit2Setup.tokenApproveTxHash = tx.hash;
            emitUx("SETUP_TX_SENT", { type: "ERC20_APPROVE_TO_PERMIT2", txHash: tx.hash });
            await tx.wait(1);
          } else {
            throw err;
          }
        }
      }

      const permit2Abi = [
        "function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)",
        "function approve(address token,address spender,uint160 amount,uint48 expiration)",
      ];
      const permit2 = new ethers.Contract(permit2Address, permit2Abi, publicRpc);
      const [permit2Amount, permit2Exp] = await permit2.allowance(ownerEoa, token, router);
      result.permit2Setup.needsPermit2Approve =
        BigInt(permit2Amount) < required || BigInt(permit2Exp) < BigInt(nowTs + 3600);

      console.log(
        `PERMIT2_ALLOWANCE=${permit2Amount} EXP=${permit2Exp} REQUIRED=${required} AUTO_SETUP_PERMIT2=${autoSetupPermit2 ? "1" : "0"}`
      );

      if (result.permit2Setup.needsPermit2Approve) {
        console.log("NEEDS_SETUP=PERMIT2_ALLOWANCE_LOW");
        emitUx("SETUP_REQUIRED", { type: "PERMIT2_ALLOWANCE_LOW" });
        if (!autoSetupPermit2) {
          console.log("NEXT=set AUTO_SETUP_PERMIT2=1");
          return result;
        }
        const hasEth = await maybeRunPermit2Stipend();
        if (!hasEth) {
          result.lane.reasons.push("NEEDS_OWNER_ETH_FOR_SETUP");
          return result;
        }
        if (!ownerPk) {
          result.lane.reasons.push("NEEDS_OWNER_PK_FOR_AUTO_SETUP");
          console.log("REASON=NEEDS_OWNER_PK_FOR_AUTO_SETUP");
          console.log("NEXT=set OWNER_PK or run cast command");
          return result;
        }
        const ownerSigner = new ethers.Wallet(ownerPk, publicRpc);
        if (toLower(ownerSigner.address) !== toLower(ownerEoa)) {
          result.lane.reasons.push("OWNER_PK_MISMATCH");
          console.log("REASON=OWNER_PK_MISMATCH");
          return result;
        }
        const permit2WithSigner = permit2.connect(ownerSigner);
        try {
          const tx = await permit2WithSigner.approve(token, router, maxUint160, maxUint48);
          setupTxs.push(tx.hash);
          result.permit2Setup.permit2ApproveTxHash = tx.hash;
          emitUx("SETUP_TX_SENT", { type: "PERMIT2_APPROVE", txHash: tx.hash });
          console.log(`PERMIT2_APPROVE_TX=${tx.hash}`);
          await tx.wait(1);
        } catch (err) {
          if (isInsufficientFunds(err)) {
            result.permit2Setup.setupRetried = true;
            const toppedUp = await maybeRunPermit2Stipend();
            if (!toppedUp) {
              result.lane.reasons.push("NEEDS_OWNER_ETH_FOR_SETUP");
              return result;
            }
            const tx = await permit2WithSigner.approve(token, router, maxUint160, maxUint48);
            setupTxs.push(tx.hash);
            result.permit2Setup.permit2ApproveTxHash = tx.hash;
            emitUx("SETUP_TX_SENT", { type: "PERMIT2_APPROVE", txHash: tx.hash });
            console.log(`PERMIT2_APPROVE_TX=${tx.hash}`);
            await tx.wait(1);
          } else {
            throw err;
          }
        }
        const [amountAfter] = await permit2.allowance(ownerEoa, token, router);
        if (BigInt(amountAfter) < required) {
          result.lane.reasons.push("PERMIT2_ALLOWANCE_STILL_LOW");
          console.log("REASON=PERMIT2_ALLOWANCE_STILL_LOW");
          return result;
        }
      }

      console.log(`USING_FINAL_FEE=${quotedFee} (source=paymaster_quote)`);
      emitUx("SEND_SUBMITTED", { lane: "PERMIT2" });
      const res = spawnSync("node", ["scripts/aa/send_permit2_v5.mjs"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env: { ...process.env, FINAL_FEE: String(quotedFee) },
      });
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      userOpHash = extractUserOpHash(res.stdout || "");
      result.userOp.userOpHash = userOpHash;
      if (userOpHash) emitUx("SEND_SUBMITTED", { userOpHash });
      const receipt = await fetchUserOpReceipt(bundlerUrl, userOpHash);
      if (receipt) {
        const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
        console.log(`RECEIPT_SUCCESS=${receipt.success}`);
        console.log(`RECEIPT_TX=${receipt.receipt?.transactionHash ?? ""}`);
        console.log(`TRANSFER_TO=${toAmount}`);
        console.log(`TRANSFER_FEE=${feeAmount}`);
        emitUx("RECEIPT_CONFIRMED", { success: receipt.success, txHash: receipt.receipt?.transactionHash || "" });
        emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
        result.receipt = {
          success: !!receipt.success,
          transactionHash: receipt.receipt?.transactionHash || "",
          transfers: { toAmount, feeAmount },
          raw: receipt,
        };
        result.userOp.success = !!receipt.success;
        result.userOp.txHash = receipt.receipt?.transactionHash || "";
      }
    }

    if (lane === "AA") {
      const allowanceAa = await tokenContract.allowance(sender, router);
      if (BigInt(allowanceAa) < amount) {
        if (!autoSetupAaApprove) {
          result.lane.reasons.push("NEEDS_AA_APPROVE");
          console.log("NEEDS_SETUP=AA_APPROVE");
          console.log("NEXT=Run scripts/aa/activate_approve_v5.mjs");
          return result;
        }
        emitUx("SETUP_REQUIRED", { type: "AA_APPROVE" });
        const resApprove = spawnSync("node", ["scripts/aa/activate_approve_v5.mjs"], {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        });
        if (resApprove.stdout) process.stdout.write(resApprove.stdout);
        if (resApprove.stderr) process.stderr.write(resApprove.stderr);
        const approveHash = extractUserOpHash(resApprove.stdout || "");
        if (!approveHash) {
          result.lane.reasons.push("AA_APPROVE_FAILED");
          console.log("REASON=AA_APPROVE_FAILED");
          return result;
        }
        const approveReceipt = await fetchUserOpReceipt(bundlerUrl, approveHash);
        if (!approveReceipt?.success) {
          result.lane.reasons.push("AA_APPROVE_USEROP_FAILED");
          console.log("REASON=AA_APPROVE_USEROP_FAILED");
          return result;
        }
      }

      console.log(`USING_FINAL_FEE=${quotedFee} (source=paymaster_quote)`);
      emitUx("SEND_SUBMITTED", { lane: "AA" });
      const res = spawnSync("node", ["scripts/aa/send_v5.mjs"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env: { ...process.env, MAX_FEE_USDC6: String(quotedFee), SEND_AMOUNT_USDC6: String(amount) },
      });
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      userOpHash = extractUserOpHash(res.stdout || "");
      result.userOp.userOpHash = userOpHash;
      if (userOpHash) emitUx("SEND_SUBMITTED", { userOpHash });
      const receipt = await fetchUserOpReceipt(bundlerUrl, userOpHash);
      if (receipt) {
        const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
        console.log(`RECEIPT_SUCCESS=${receipt.success}`);
        console.log(`RECEIPT_TX=${receipt.receipt?.transactionHash ?? ""}`);
        console.log(`TRANSFER_TO=${toAmount}`);
        console.log(`TRANSFER_FEE=${feeAmount}`);
        emitUx("RECEIPT_CONFIRMED", { success: receipt.success, txHash: receipt.receipt?.transactionHash || "" });
        emitUx("TRANSFERS_DECODED", { toAmount, feeAmount });
        result.receipt = {
          success: !!receipt.success,
          transactionHash: receipt.receipt?.transactionHash || "",
          transfers: { toAmount, feeAmount },
          raw: receipt,
        };
        result.userOp.success = !!receipt.success;
        result.userOp.txHash = receipt.receipt?.transactionHash || "";
      }
    }

    console.log("SUMMARY");
    console.log(`LANE=${lane}`);
    console.log(`REASON=${result.lane.reasons.join("|")}`);
    console.log(`AMOUNT=${amount}`);
    console.log(`FEE=${quotedFee}`);
    console.log(`NET=${netAmount}`);
    console.log(`TOKEN=${token}`);
    console.log(`TO=${to}`);
    console.log(`SENDER=${sender}`);
    console.log(`OWNER_EOA=${ownerEoa || ""}`);
    console.log(`SETUP_TXS=${formatSetupTxs(tokenApproveTxHash, permit2ApproveTxHash, stipendUserOpHash)}`);
    console.log(`USEROP_HASH=${userOpHash || "none"}`);
    console.log(`TX_HASH=${txHash || "none"}`);

    result.success = !!result.userOp.success;
    return result;
  }

async function run() {
  const { jsonOutPath } = parseArgs(process.argv);
  const dir = path.dirname(jsonOutPath);
  fs.mkdirSync(dir, { recursive: true });
  let result = null;
  try {
    result = await main(jsonOutPath);
    emitUx("UX_DONE", { success: !!result?.success, jsonOutPath });
  } catch (err) {
    result = result || { success: false };
    result.success = false;
    result.error = { name: err?.name || "Error", message: err?.message || String(err), stack: err?.stack };
    emitUx("UX_DONE", { success: false, jsonOutPath });
    process.exitCode = 1;
  } finally {
    try {
      fs.writeFileSync(jsonOutPath, JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(err);
      process.exitCode = 1;
    }
  }
}

run();
*/
