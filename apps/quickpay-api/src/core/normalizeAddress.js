import { getAddress, isAddress } from "ethers";
import { getRpcTimeoutMs, withTimeout } from "./withTimeout.js";

export async function normalizeAddress(input, { chainId, provider }) {
  const s = String(input ?? "").trim();

  if (isAddress(s)) return getAddress(s);

  if (Number(chainId) !== 1) {
    const err = new Error("ENS not supported on this network. Please enter a 0x address.");
    err.status = 400;
    err.code = "ENS_UNSUPPORTED";
    throw err;
  }

  const resolved = await withTimeout(provider.resolveName(s), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "normalizeAddress.resolveName",
    message: "RPC timeout",
  });
  if (!resolved) {
    const err = new Error(`Could not resolve ENS name: ${s}`);
    err.status = 400;
    err.code = "ENS_NOT_FOUND";
    throw err;
  }
  return getAddress(resolved);
}
