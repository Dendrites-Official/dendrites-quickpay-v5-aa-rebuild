import { spawn } from "node:child_process";

function normalizeTimeout(value, fallback) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRpcTimeoutMs() {
  return normalizeTimeout(process.env.RPC_TIMEOUT_MS, 6000);
}

export function getBundlerTimeoutMs() {
  return normalizeTimeout(process.env.BUNDLER_TIMEOUT_MS, 6000);
}

export function getOrchestratorTimeoutMs() {
  return normalizeTimeout(process.env.ORCHESTRATOR_TIMEOUT_MS, 90000);
}

export function withTimeout(promise, timeoutMs, meta = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(meta?.message || "timeout");
      err.code = meta?.code || "TIMEOUT";
      err.status = meta?.status || 504;
      err.where = meta?.where;
      err.timeoutMs = timeoutMs;
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch {
    // ignore kill errors
  }
}

export async function spawnWithTimeout(command, args, options = {}, timeoutMs, meta = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const onExit = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: typeof code === "number" ? code : null, error: null });
    };

    const onError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: null, error });
    };

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("error", onError);
    child.on("exit", onExit);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      const err = new Error(meta?.message || "ORCHESTRATOR_TIMEOUT");
      err.code = meta?.code || "ORCHESTRATOR_TIMEOUT";
      err.status = meta?.status || 504;
      err.where = meta?.where;
      err.timeoutMs = timeoutMs;
      reject(err);
    }, timeoutMs);
  });
}
