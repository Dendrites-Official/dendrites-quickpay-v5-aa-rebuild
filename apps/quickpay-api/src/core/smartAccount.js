import { ethers, getAddress, isAddress } from "ethers";
import { createTtlCache } from "./cache.js";
import { getRpcTimeoutMs, withTimeout } from "./withTimeout.js";

const FACTORY_ABI = [
  "function getAddress(address owner, uint256 salt) view returns (address)",
];

const smartAccountCache = createTtlCache({ ttlMs: 60000, maxSize: 2000 });

export async function resolveSmartAccount({ rpcUrl, factoryAddress, ownerEoa, factorySource }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  if (!isAddress(factoryAddress)) {
    const source = factorySource ? String(factorySource) : "unknown";
    const raw = String(factoryAddress ?? "");
    const err = new Error(`Invalid factory address (source=${source}, value="${raw}")`);
    err.status = 500;
    err.code = "CONFIG_FACTORY_INVALID";
    throw err;
  }
  if (!isAddress(ownerEoa)) {
    throw new Error("Invalid owner address");
  }
  const factoryAddr = getAddress(factoryAddress);
  const ownerAddr = getAddress(ownerEoa);
  const cacheKey = `${rpcUrl}:${factoryAddr.toLowerCase()}:${ownerAddr.toLowerCase()}`;
  const cached = smartAccountCache.get(cacheKey);
  if (cached) return cached;
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
  const sender = await withTimeout(factory["getAddress(address,uint256)"](ownerAddr, 0n), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "smartAccount.getAddress",
    message: "RPC timeout",
  });
  const code = await withTimeout(provider.getCode(sender), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "smartAccount.getCode",
    message: "RPC timeout",
  });
  const deployed = typeof code === "string" && code !== "0x";
  const result = { sender, deployed };
  smartAccountCache.set(cacheKey, result);
  return result;
}
