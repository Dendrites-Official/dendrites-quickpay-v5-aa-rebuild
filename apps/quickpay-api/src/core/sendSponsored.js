import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseResultFile(jsonOutPath) {
  if (!fs.existsSync(jsonOutPath)) return null;
  const raw = fs.readFileSync(jsonOutPath, "utf8");
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function sendSponsored({
  chainId,
  ownerEoa,
  token,
  to,
  amount,
  feeMode,
  speed,
  mode,
  receiptId,
  quotedFeeTokenAmount,
  auth,
}) {
  const repoRoot = process.env.APP_ROOT ? String(process.env.APP_ROOT).trim() : process.cwd();
  const outDir = path.join(repoRoot, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonOutPath = path.join(outDir, `orchestrate_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);

  const env = {
    ...process.env,
    CHAIN_ID: String(chainId ?? ""),
    OWNER_EOA: String(ownerEoa ?? ""),
    TOKEN: String(token ?? ""),
    TO: String(to ?? ""),
    AMOUNT: String(amount ?? ""),
    SPEED: String(speed ?? ""),
    MODE: String(mode ?? ""),
    FEE_MODE: String(feeMode ?? ""),
    QUOTED_FEE_TOKEN_AMOUNT: quotedFeeTokenAmount != null ? String(quotedFeeTokenAmount) : "",
    AUTH_JSON: JSON.stringify(auth ?? null),
    RECEIPT_ID: String(receiptId ?? ""),
  };

  const res = spawnSync("node", ["scripts/aa/orchestrate_send_v5.mjs", "--json-out", jsonOutPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env,
  });

  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    const err = new Error(`orchestrate_send_v5 failed: ${res.stderr || "unknown error"}`);
    err.stderr = res.stderr;
    throw err;
  }

  const result = parseResultFile(jsonOutPath);
  if (!result) {
    throw new Error(`orchestrate_send_v5 missing output: ${jsonOutPath}`);
  }
  return result;
}
