import { getAddress, isAddress } from "ethers";

export async function normalizeAddress(input, { chainId, provider }) {
  const s = String(input ?? "").trim();

  if (isAddress(s)) return getAddress(s);

  if (Number(chainId) !== 1) {
    const err = new Error("ENS not supported on this network. Please enter a 0x address.");
    err.status = 400;
    err.code = "ENS_UNSUPPORTED";
    throw err;
  }

  const resolved = await provider.resolveName(s);
  if (!resolved) {
    const err = new Error(`Could not resolve ENS name: ${s}`);
    err.status = 400;
    err.code = "ENS_NOT_FOUND";
    throw err;
  }
  return getAddress(resolved);
}
