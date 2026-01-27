import { JsonRpcProvider } from "ethers";

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
      const network = await provider.getNetwork();
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
