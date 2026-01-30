import { JsonRpcProvider } from "ethers";
import { getRpcTimeoutMs, withTimeout } from "./withTimeout.js";

export async function resolveRpcUrl({ rpcUrl, bundlerUrl, chainId }) {
  const candidates = [rpcUrl, bundlerUrl]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  if (!candidates.length) {
    const err = new Error("Missing RPC_URL/BUNDLER_URL for chain resolution");
    err.status = 500;
    err.code = "RPC_URL_MISSING";
    throw err;
  }

  for (const candidate of candidates) {
    try {
      const provider = new JsonRpcProvider(candidate);
      const network = await withTimeout(provider.getNetwork(), getRpcTimeoutMs(), {
        code: "RPC_TIMEOUT",
        status: 504,
        where: "resolveRpcUrl.getNetwork",
        message: "RPC timeout",
      });
      if (Number(network?.chainId) === Number(chainId)) {
        return candidate;
      }
    } catch {
      // ignore and try next candidate
    }
  }

  const err = new Error("RPC_URL/BUNDLER_URL chainId mismatch");
  err.status = 500;
  err.code = "RPC_CHAIN_MISMATCH";
  throw err;
}
