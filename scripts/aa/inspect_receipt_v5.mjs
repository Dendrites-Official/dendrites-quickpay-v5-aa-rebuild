import { ethers } from "ethers";
import { getConfig } from "../lib/config.mjs";

function toLower(addr) {
  return String(addr).toLowerCase();
}

function requireBytes32Hex(name, value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid ${name} (must be 0x-prefixed 32-byte hex): ${value}`);
  }
  return value;
}

function asArray(maybeArray) {
  if (maybeArray == null) return [];
  if (!Array.isArray(maybeArray)) {
    throw new Error(`Expected logs array, got: ${typeof maybeArray}`);
  }
  return maybeArray;
}

async function main() {
  const cfg = getConfig();

  const userOpHash = requireBytes32Hex("userOpHash", process.argv[2]);

  const bundlerRpc = new ethers.JsonRpcProvider(cfg.bundlerUrl);

  const receipt = await bundlerRpc.send("eth_getUserOperationReceipt", [userOpHash]);
  if (receipt == null || typeof receipt !== "object") {
    throw new Error(`Invalid eth_getUserOperationReceipt response: ${JSON.stringify(receipt)}`);
  }

  const success = receipt.success;
  if (success !== true) {
    throw new Error(`UserOp not successful (success=${String(success)})`);
  }

  const sender = receipt.sender;
  const paymaster = receipt.paymaster;
  const entryPoint = receipt.entryPoint;
  const nonce = receipt.nonce;
  const actualGasUsed = receipt.actualGasUsed;
  const actualGasCost = receipt.actualGasCost;

  const txHash = receipt?.receipt?.transactionHash;
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error(`Missing or invalid transactionHash in receipt: ${txHash}`);
  }

  // 1) Print core fields
  console.log(`userOpHash=${userOpHash}`);
  console.log(`success=${String(success)}`);
  console.log(`sender=${sender}`);
  console.log(`paymaster=${paymaster}`);
  console.log(`entryPoint=${entryPoint}`);
  console.log(`nonce=${nonce}`);
  console.log(`actualGasUsed=${actualGasUsed}`);
  console.log(`actualGasCost=${actualGasCost}`);
  console.log(`transactionHash=${txHash}`);

  if (!ethers.isAddress(sender)) throw new Error(`Invalid sender address: ${sender}`);
  if (!ethers.isAddress(cfg.addresses.usdc)) throw new Error(`Invalid USDC address: ${cfg.addresses.usdc}`);
  if (!ethers.isAddress(cfg.addresses.feeVault)) throw new Error(`Invalid FEEVAULT address: ${cfg.addresses.feeVault}`);

  const senderLower = toLower(sender);
  const usdcLower = toLower(cfg.addresses.usdc);
  const feeVaultLower = toLower(cfg.addresses.feeVault);

  // 2) Decode Transfer logs
  const erc20Iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);
  const transferTopic = erc20Iface.getEvent("Transfer").topicHash;

  const logs = [...asArray(receipt.logs), ...asArray(receipt?.receipt?.logs)];
  if (logs.length === 0) {
    throw new Error("No logs found in userOp receipt");
  }

  let totalOutFromSender = 0n;
  let toRecipientBySender = 0n;
  let toFeeVaultBySender = 0n;

  let recipientLower = null;

  for (const log of logs) {
    if (log == null || typeof log !== "object") {
      throw new Error(`Invalid log entry: ${JSON.stringify(log)}`);
    }

    const addr = log.address;
    const topics = log.topics;
    const data = log.data;

    if (typeof addr !== "string" || !Array.isArray(topics) || typeof data !== "string") {
      throw new Error(`Malformed log: ${JSON.stringify(log)}`);
    }

    if (toLower(addr) !== usdcLower) continue;
    if (topics.length === 0 || toLower(topics[0]) !== toLower(transferTopic)) continue;

    let parsed;
    try {
      parsed = erc20Iface.parseLog({ topics, data });
    } catch (err) {
      throw err;
    }

    const from = parsed.args.from;
    const to = parsed.args.to;
    const value = parsed.args.value;

    if (!ethers.isAddress(from) || !ethers.isAddress(to)) {
      throw new Error(`Invalid Transfer args: from=${from} to=${to}`);
    }
    if (typeof value !== "bigint") {
      throw new Error(`Invalid Transfer value type: ${typeof value}`);
    }

    if (toLower(from) !== senderLower) continue;

    totalOutFromSender += value;

    if (toLower(to) === feeVaultLower) {
      toFeeVaultBySender += value;
    } else {
      toRecipientBySender += value;
      const toLowered = toLower(to);
      if (recipientLower == null) {
        recipientLower = toLowered;
      } else if (recipientLower !== toLowered) {
        throw new Error(`Multiple non-feeVault recipients detected: ${recipientLower} and ${toLowered}`);
      }
    }
  }

  // 3) Validation checks
  if (totalOutFromSender !== toRecipientBySender + toFeeVaultBySender) {
    throw new Error(
      `Invariant failed: totalOutFromSender != toRecipientBySender + toFeeVaultBySender (${totalOutFromSender} != ${
        toRecipientBySender + toFeeVaultBySender
      })`
    );
  }
  if (toFeeVaultBySender <= 0n) {
    throw new Error("Expected fee transfer to FeeVault (>0)");
  }
  if (toRecipientBySender <= 0n) {
    throw new Error("Expected payment transfer to recipient (>0)");
  }
  if (recipientLower == null) {
    throw new Error("Could not determine recipient (no non-feeVault transfer from sender)");
  }

  const senderChecksum = ethers.getAddress(sender);
  const recipientChecksum = ethers.getAddress(recipientLower);

  // 4) Print final summary
  console.log("INSPECT_OK");
  console.log(`SENDER=${senderChecksum}`);
  console.log(`RECIPIENT=${recipientChecksum}`);
  console.log(`SENT_USDC=${ethers.formatUnits(toRecipientBySender, 6)}`);
  console.log(`FEE_USDC=${ethers.formatUnits(toFeeVaultBySender, 6)}`);
  console.log(`TOTAL_OUT_USDC=${ethers.formatUnits(totalOutFromSender, 6)}`);
  console.log(`TX=${txHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
