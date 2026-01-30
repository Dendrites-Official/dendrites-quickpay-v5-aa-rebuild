const SENSITIVE_KEYS = [
  "auth",
  "auth_json",
  "signature",
  "sig",
  "private",
  "private_key",
  "secret",
  "authjson",
  "useropsignature",
  "useropdraft",
];

function shouldRedactKey(key) {
  const lower = String(key || "").toLowerCase();
  return SENSITIVE_KEYS.some((needle) => lower.includes(needle));
}

export function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, val] of Object.entries(value)) {
      output[key] = shouldRedactKey(key) ? "[REDACTED]" : redactSensitive(val);
    }
    return output;
  }
  return value;
}

export function createLogger({ reqId } = {}) {
  const base = reqId ? { reqId } : {};
  const log = (level, msg, data = {}) => {
    const payload = {
      level,
      msg,
      ...base,
      ...(data ? redactSensitive(data) : {}),
    };
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
