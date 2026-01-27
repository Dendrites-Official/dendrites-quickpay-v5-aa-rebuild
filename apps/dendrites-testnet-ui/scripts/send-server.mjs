import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root = .../apps/dendrites-testnet-ui/scripts -> go up 3
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

// allow BOTH common vite ports
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
]);

const PAYMASTER_ABI = [
  "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
  "function feeTokenDecimals(address token) view returns (uint8)",
  "function usd6PerWholeToken(address token) view returns (uint256)",
];

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function parseSpeed({ feeMode, speed }) {
  if (typeof speed === "number") return speed;
  if (typeof speed === "string" && speed !== "") return Number(speed);
  return String(feeMode ?? "eco").toLowerCase() === "instant" ? 1 : 0;
}

function parseList(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function selectLane(token, { eip3009Tokens, eip2612Tokens }) {
  const tokenLower = String(token).toLowerCase();
  if (eip3009Tokens.has(tokenLower)) return "EIP3009";
  if (eip2612Tokens.has(tokenLower)) return "EIP2612";
  return "PERMIT2";
}

function extractMatch(output, pattern) {
  const match = String(output || "").match(pattern);
  return match ? match[1] : "";
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  if (req.method !== "POST" || (req.url !== "/send" && req.url !== "/quote")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not_found" }));
  }

  try {
    const body = await readJson(req);

    const {
      from,
      fromEoa,
      receiptId,
      chainId,
      token,
      to,
      amount,
      feeMode,
      speed,
      selfPay,
      mode,
    } = body || {};
    const senderEoa = fromEoa ?? from;
    const missing = [];
    const required = req.url === "/quote"
      ? ["fromEoa", "chainId", "token", "to", "amount"]
      : ["fromEoa", "receiptId", "chainId", "token", "to", "amount"];
    for (const k of required) {
      if (k === "fromEoa" && senderEoa) continue;
      if (!body?.[k]) missing.push(k);
    }
    if (missing.length) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "missing_fields", missing }));
    }

    if (req.url === "/quote") {
      const isSelfPay = mode === "SELF_PAY" || Boolean(selfPay);
      if (isSelfPay) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          ok: true,
          sponsored: false,
          lane: "SELF_PAY",
          feeUsd6: "0",
          feeTokenAmount: "0",
          netAmount: String(amount),
          feeTokenMode: "same",
          feeMode: feeMode ?? "eco",
          speed: parseSpeed({ feeMode, speed }),
        }));
      }

      const rpcUrl = process.env.RPC_URL || "";
      const paymaster = process.env.PAYMASTER || "";
      if (!rpcUrl || !paymaster) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "missing_env" }));
      }

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const paymasterContract = new ethers.Contract(paymaster, PAYMASTER_ABI, provider);
      const nowTs = Math.floor(Date.now() / 1000);
      const speedVal = parseSpeed({ feeMode, speed });
      const quoteRaw = await paymasterContract.quoteFeeUsd6(senderEoa, 0, speedVal, nowTs);
      const baselineUsd6 = BigInt(quoteRaw[0]);
      const surchargeUsd6 = BigInt(quoteRaw[1]);
      const totalUsd6 = baselineUsd6 + surchargeUsd6;
      const decimals = Number(await paymasterContract.feeTokenDecimals(token));
      const price = BigInt(await paymasterContract.usd6PerWholeToken(token));
      const pow10 = 10n ** BigInt(decimals);
      const finalFeeTokenAmount = ceilDiv(totalUsd6 * pow10, price);
      const netAmount = (BigInt(amount) - finalFeeTokenAmount).toString();
      const lane = selectLane(token, {
        eip3009Tokens: parseList(process.env.EIP3009_TOKENS),
        eip2612Tokens: parseList(process.env.EIP2612_TOKENS),
      });

      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        ok: true,
        sponsored: true,
        lane,
        feeUsd6: totalUsd6.toString(),
        feeTokenAmount: finalFeeTokenAmount.toString(),
        netAmount,
        feeTokenMode: "same",
        feeMode: feeMode ?? "eco",
        speed: speedVal,
      }));
    }

    // Call orchestrator script
    const args = [
      "scripts/aa/orchestrate_send_v5.mjs",
    ];
    const isSelfPay = mode === "SELF_PAY" || Boolean(selfPay);

    const child = spawn("node", args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OWNER_EOA: String(senderEoa),
        TOKEN: String(token),
        TO: String(to),
        AMOUNT: String(amount),
        FEE_MODE: String(feeMode ?? process.env.FEE_MODE ?? "eco"),
        SPEED: String(typeof speed !== "undefined" ? speed : parseSpeed({ feeMode, speed })),
        RECEIPT_ID: String(receiptId),
        SELF_PAY: isSelfPay ? "1" : "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      const userOpHash = extractMatch(stdout, /USEROP_HASH=([0x0-9a-fA-F]+)/);
      const txHash = extractMatch(stdout, /RECEIPT_TX=([0x0-9a-fA-F]+)/);
      res.writeHead(code === 0 ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: code === 0, code, userOpHash, txHash, stdout, stderr }));
    });
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "server_error", message: String(e?.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`QuickPay send server listening on http://localhost:${PORT}/send`);
  console.log(`Repo root: ${REPO_ROOT}`);
});
