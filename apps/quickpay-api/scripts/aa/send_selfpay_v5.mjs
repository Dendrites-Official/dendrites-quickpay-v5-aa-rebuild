import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

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

function emitUx(type, data = {}) {
  const evt = { ts: new Date().toISOString(), type, ...data };
  console.log("UX_EVENT=" + JSON.stringify(evt));
  return evt;
}

function summarizeTransfers(receipt, token, to, feeVault) {
  if (!receipt || !receipt.logs) return { toAmount: "", feeAmount: "" };
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  let toAmount = "";
  let feeAmount = "";
  for (const log of receipt.logs) {
    if (!log || !log.topics || log.topics[0]?.toLowerCase() !== transferTopic) continue;
    if (log.address?.toLowerCase() !== token.toLowerCase()) continue;
    const toTopic = log.topics[2]?.toLowerCase();
    if (!toTopic) continue;
    const data = log.data ?? "0x";
    const amount = BigInt(data);
    if (toTopic === ethers.zeroPadValue(toLower(to), 32)) {
      toAmount = amount.toString();
    }
    if (toTopic === ethers.zeroPadValue(toLower(feeVault), 32)) {
      feeAmount = amount.toString();
    }
  }
  return { toAmount, feeAmount };
}

function parseArgs(argv) {
  const out = { jsonOutPath: "out/selfpay_last.json" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json-out" && argv[i + 1]) {
      out.jsonOutPath = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main() {
  const result = {
    success: false,
    txHash: "",
    receipt: { success: false, transactionHash: "", transfers: { toAmount: "", feeAmount: "" } },
    transfers: { toAmount: "", feeAmount: "" },
    gasEstimate: null,
  };
  const rpcUrl = requireEnv("RPC_URL");
  const routerAddr = requireEnv("ROUTER");
  const feeVault = requireEnv("FEEVAULT");
  const ownerEoa = requireEnv("OWNER_EOA");
  const token = requireEnv("TOKEN");
  const to = requireEnv("TO");
  const speed = Number(process.env.SPEED ?? "0");
  const amount = BigInt(requireEnv("AMOUNT"));
  const finalFeeToken = BigInt(process.env.FINAL_FEE_TOKEN || process.env.FINAL_FEE || "0");

  if (finalFeeToken > amount) {
    throw new Error("AMOUNT_TOO_SMALL_FOR_FEE");
  }
  const netAmount = amount;

  const signer = new ethers.Wallet(requireEnv("PRIVATE_KEY_TEST_USER"));
  if (toLower(signer.address) !== toLower(ownerEoa)) {
    throw new Error(`OWNER_EOA must equal signer. signer=${signer.address} ownerEoa=${ownerEoa}`);
  }

  const publicRpc = new ethers.JsonRpcProvider(rpcUrl);
  const ownerSigner = signer.connect(publicRpc);

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
  ];
  const erc20 = new ethers.Contract(token, ERC20_ABI, ownerSigner);
  const bal = await erc20.balanceOf(ownerEoa);
  if (BigInt(bal) < amount) {
    throw new Error(`INSUFFICIENT_BALANCE(OWNER): need ${amount} have ${bal}`);
  }
  console.log(`SPEED=${speed}`);
  console.log(`NET_AMOUNT=${netAmount}`);

  const txReq = await erc20.getFunction("transfer").populateTransaction(to, amount);
  txReq.from = ownerEoa;
  const gasLimit = await publicRpc.estimateGas(txReq);
  const feeData = await publicRpc.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
  const estCostWei = gasLimit * maxFeePerGas;
  const gasEstimatePayload = {
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    estCostWei: estCostWei.toString(),
    estCostEth: ethers.formatEther(estCostWei),
  };
  emitUx("NETWORK_GAS_ESTIMATE", gasEstimatePayload);
  result.gasEstimate = gasEstimatePayload;

  const tx = await erc20.transfer(to, amount, { gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  console.log(`TX_HASH=${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("No receipt");
  const receiptTx = receipt?.hash ?? receipt?.transactionHash ?? tx.hash;
  console.log(`RECEIPT_SUCCESS=${receipt.status === 1}`);
  console.log(`RECEIPT_TX=${receiptTx}`);
  console.log(`MINED_BLOCK=${receipt.blockNumber}`);

  const { toAmount, feeAmount } = summarizeTransfers(receipt, token, to, feeVault);
  const toAmountOut = toAmount || amount.toString();
  const feeAmountOut = "0";
  if (toAmountOut) console.log(`TRANSFER_TO=${toAmountOut}`);
  console.log(`TRANSFER_FEE=${feeAmountOut}`);

  result.success = receipt.status === 1;
  result.txHash = receiptTx;
  result.receipt = {
    success: receipt.status === 1,
    transactionHash: receiptTx,
    transfers: { toAmount: toAmountOut, feeAmount: feeAmountOut },
  };
  result.transfers = { toAmount: toAmountOut, feeAmount: feeAmountOut };
  return result;
}

async function run() {
  const { jsonOutPath } = parseArgs(process.argv);
  const dir = path.dirname(jsonOutPath);
  fs.mkdirSync(dir, { recursive: true });
  let result = null;
  try {
    result = await main();
    fs.writeFileSync(jsonOutPath, JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
    const out = {
      success: false,
      error: {
        name: err?.name || "Error",
        message: String(err?.message || err),
        stack: String(err?.stack || ""),
      },
    };
    fs.writeFileSync(jsonOutPath, JSON.stringify(out, null, 2));
    process.exitCode = 1;
  }
}

run();
