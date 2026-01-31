import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PAYMASTER_ABI = [
  "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
  "function feeTokenDecimals(address token) view returns (uint8)",
  "function usd6PerWholeToken(address token) view returns (uint256)",
];

const FACTORY_ABI = ["function getAddress(address owner, uint256 salt) view returns (address)"];

const ERC20_ABI = [
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function requireTestUserKey() {
  const value = String(process.env.PRIVATE_KEY_TEST_USER || "").trim();
  if (!value) {
    throw new Error("Missing PRIVATE_KEY_TEST_USER for bulk smoke test signing");
  }
  return value;
}

function ceilDiv(a, b) {
  if (a === 0n) return 0n;
  return (a + b - 1n) / b;
}

async function runBulkScript({ scriptPath, env }) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Bulk script not found: ${scriptPath}`);
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `quickpay-bulk-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  const result = await new Promise((resolve) => {
    const child = spawn("node", [scriptPath, "--json-out", tmpFile], { env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });

  let json = null;
  if (fs.existsSync(tmpFile)) {
    const raw = fs.readFileSync(tmpFile, "utf-8");
    json = JSON.parse(raw);
  }

  if (result.code !== 0) {
    if (json?.needsUserOpSignature) {
      return { ...json, ok: false };
    }
    throw new Error(`Bulk script failed: ${result.stderr || result.stdout}`.trim());
  }

  return { ...json, ok: true };
}

async function main() {
  const routerBulk = requireEnv("ROUTER_BULK");
  const paymasterBulk = requireEnv("PAYMASTER_BULK");
  const usdc = requireEnv("USDC");
  const entryPoint = requireEnv("ENTRYPOINT");
  const factory = requireEnv("FACTORY");
  const feeVault = requireEnv("FEEVAULT");
  const rpcUrl = requireEnv("RPC_URL");
  const bundlerUrl = requireEnv("BUNDLER_URL");

  const ownerPk = requireTestUserKey();

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(bundlerUrl);
  const wallet = new ethers.Wallet(ownerPk, provider);
  const owner = await wallet.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  const token = new ethers.Contract(usdc, ERC20_ABI, provider);
  const paymaster = new ethers.Contract(paymasterBulk, PAYMASTER_ABI, provider);
  const factoryContract = new ethers.Contract(factory, FACTORY_ABI, provider);

  let tokenName = "USD Coin";
  let tokenVersion = "2";
  try {
    tokenName = await token.name();
  } catch {}
  try {
    tokenVersion = await token.version();
  } catch {}

  const recipients = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
  const amounts = [1_000_000n, 1_000_000n];
  const totalNet = amounts.reduce((a, b) => a + b, 0n);

  const beforeBalances = await Promise.all(recipients.map((addr) => token.balanceOf(addr)));
  const beforeFeeVault = await token.balanceOf(feeVault);

  const nowTs = Math.floor(Date.now() / 1000);
  const smartSender = await factoryContract["getAddress(address,uint256)"](owner, 0n);
  const quote = await paymaster.quoteFeeUsd6(smartSender, 0, 1, nowTs);
  const feeUsd6 = BigInt(quote[2]);
  const maxFeeUsd6 = BigInt(quote[4]);
  const decimals = BigInt(await paymaster.feeTokenDecimals(usdc));
  const usd6PerWhole = BigInt(await paymaster.usd6PerWholeToken(usdc));
  const feeTokenAmount = ceilDiv(feeUsd6 * 10n ** decimals, usd6PerWhole);
  console.log("payer=", smartSender);
  console.log("feeUsd6=", feeUsd6.toString());
  console.log("feeTokenAmount=", feeTokenAmount.toString());

  const totalWithFee = totalNet + feeTokenAmount;

  const ownerBalance = await token.balanceOf(owner);
  if (ownerBalance < totalWithFee) {
    throw new Error(
      `Insufficient USDC balance for owner. Need ${totalWithFee.toString()} but have ${ownerBalance.toString()}`
    );
  }

  const validAfter = nowTs - 10;
  const validBefore = nowTs + 3600;
  const nonce = ethers.hexlify(ethers.randomBytes(32));

  const authMessage = {
    from: owner,
    to: routerBulk,
    value: totalWithFee,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await wallet.signTypedData(
    {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: usdc,
    },
    {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    authMessage
  );

  const authJson = {
    type: "EIP3009",
    from: authMessage.from,
    to: authMessage.to,
    value: authMessage.value.toString(),
    validAfter: authMessage.validAfter.toString(),
    validBefore: authMessage.validBefore.toString(),
    nonce: authMessage.nonce,
    signature,
  };

  const referenceId = ethers.hexlify(ethers.randomBytes(32));

  const scriptPath = path.join(
    process.cwd(),
    "apps",
    "quickpay-api",
    "src",
    "aa",
    "send_bulk_usdc_eip3009.mjs"
  );

  const baseEnv = {
    ...process.env,
    ROUTER_BULK: routerBulk,
    PAYMASTER_BULK: paymasterBulk,
    USDC: usdc,
    ENTRYPOINT: entryPoint,
    FACTORY: factory,
    FEEVAULT: feeVault,
    RPC_URL: rpcUrl,
    BUNDLER_URL: bundlerUrl,
    OWNER_EOA: owner,
    TOKEN: usdc,
    RECIPIENTS_JSON: JSON.stringify(recipients),
    AMOUNTS_JSON: JSON.stringify(amounts.map((v) => v.toString())),
    FINAL_FEE_TOKEN: feeTokenAmount.toString(),
    MAX_FEE_USDC6: maxFeeUsd6.toString(),
    SPEED: "1",
    AUTH_JSON: JSON.stringify(authJson),
    REFERENCE_ID: referenceId,
  };

  let result = await runBulkScript({ scriptPath, env: baseEnv });
  if (result?.needsUserOpSignature && result?.userOpHash) {
    const sig = ethers.Signature.from(wallet.signingKey.sign(result.userOpHash)).serialized;
    const env2 = {
      ...baseEnv,
      USEROP_SIGNATURE: sig,
      USEROP_DRAFT_JSON: JSON.stringify(result.userOpDraft || {}),
    };
    result = await runBulkScript({ scriptPath, env: env2 });
  }

  const txHash = result?.txHash || result?.transactionHash || null;
  const userOpHash = result?.userOpHash || null;

  if (txHash) {
    await provider.waitForTransaction(txHash, 1);
  }

  const afterBalances = await Promise.all(recipients.map((addr) => token.balanceOf(addr)));
  const afterFeeVault = await token.balanceOf(feeVault);

  const recipientDeltas = recipients.map((_, i) => afterBalances[i] - beforeBalances[i]);
  const feeDelta = afterFeeVault - beforeFeeVault;
  const recipientsOk = recipients.every((_, i) => recipientDeltas[i] === amounts[i]);
  const feeOk = feeDelta === feeTokenAmount;

  console.log("SUMMARY");
  console.log("--------");
  console.log("userOpHash=", userOpHash);
  console.log("txHash=", txHash);
  console.log("totalNet=", totalNet.toString());
  console.log("feeAmount=", feeTokenAmount.toString());
  console.log("recipientDeltas=", recipientDeltas.map((v) => v.toString()).join(","));
  console.log("feeDelta=", feeDelta.toString());
  console.log("recipientsOk=", recipientsOk && feeOk);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
