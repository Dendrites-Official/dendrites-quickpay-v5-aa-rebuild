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
  const repoRoot = process.cwd();
  const scriptPath = path.resolve(repoRoot, "scripts/aa/orchestrate_send_v5.mjs");
  if (!fs.existsSync(scriptPath)) {
    const err = new Error(`Missing orchestrator script at ${scriptPath} (cwd=${repoRoot})`);
    err.status = 500;
    throw err;
  }
  const outDir = "/app/out";
  fs.mkdirSync(outDir, { recursive: true });
  const jsonOutPath = path.join(outDir, `orchestrate_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);

  const childEnv = {
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

  const cmd = `${process.execPath} ${scriptPath} --json-out ${jsonOutPath}`;
  const res = spawnSync(process.execPath, [scriptPath, "--json-out", jsonOutPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, ...childEnv },
  });

  const stdout = String(res.stdout ?? "");
  const stderr = String(res.stderr ?? "");
  const tail = (s) => String(s || "").slice(-4000);

  if (res.error) {
    throw res.error;
  }
  if (fs.existsSync(jsonOutPath)) {
    const raw = fs.readFileSync(jsonOutPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.ok === true || parsed?.success === true) {
      return parsed;
    }
    const msg = parsed?.error?.message || parsed?.error || parsed?.message || "orchestrator failed";
    const err = new Error(msg);
    err.details = parsed;
    throw err;
  }

  if (res.status !== 0) {
    const err = new Error(
      `orchestrate_send_v5 failed: exitCode=${res.status} signal=${res.signal}\ncmd=${cmd}\ncwd=${repoRoot}\n---stderr---\n${tail(stderr)}\n---stdout---\n${tail(stdout)}`
    );
    err.exitCode = res.status;
    err.signal = res.signal;
    err.cmd = cmd;
    err.cwd = repoRoot;
    err.details = { stdout: tail(stdout), stderr: tail(stderr) };
    throw err;
  }

  const err = new Error(
    `orchestrate_send_v5 missing output: ${jsonOutPath}\ncmd=${cmd}\ncwd=${repoRoot}\n---stderr---\n${tail(stderr)}\n---stdout---\n${tail(stdout)}`
  );
  err.details = { stdout: tail(stdout), stderr: tail(stderr) };
  throw err;
}
