import { ethers } from "ethers";

const FACTORY_ABI = [
  "function getAddress(address owner, uint256 salt) view returns (address)",
];

export async function resolveSmartAccount({ rpcUrl, factoryAddress, ownerEoa }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
  const sender = await factory["getAddress(address,uint256)"](ownerEoa, 0n);
  const code = await provider.getCode(sender);
  const deployed = typeof code === "string" && code !== "0x";
  return { sender, deployed };
}
