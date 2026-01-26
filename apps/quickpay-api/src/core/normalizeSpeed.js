export function normalizeSpeed({ feeMode, speed }) {
  const feeModeRaw = String(feeMode ?? "").trim().toLowerCase();
  const hasFeeMode = feeModeRaw !== "";

  if (hasFeeMode) {
    if (feeModeRaw === "eco") return { canonicalSpeed: 0, canonicalFeeMode: "eco" };
    if (feeModeRaw === "instant") return { canonicalSpeed: 1, canonicalFeeMode: "instant" };
    return { canonicalSpeed: 0, canonicalFeeMode: feeModeRaw };
  }

  let speedNorm = null;
  if (typeof speed === "number" && Number.isFinite(speed)) {
    speedNorm = speed;
  } else if (typeof speed === "string") {
    const trimmed = speed.trim().toLowerCase();
    if (trimmed === "eco") speedNorm = 0;
    else if (trimmed === "instant") speedNorm = 1;
    else if (/^\d+$/.test(trimmed)) speedNorm = Number(trimmed);
  }

  const canonicalSpeed = speedNorm === 1 || speedNorm === 0 ? speedNorm : 0;
  const canonicalFeeMode = canonicalSpeed === 1 ? "instant" : "eco";
  return { canonicalSpeed, canonicalFeeMode };
}
