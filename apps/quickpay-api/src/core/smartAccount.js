import { ethers, getAddress, isAddress } from "ethers";

const FACTORY_ABI = [
  "function getAddress(address owner, uint256 salt) view returns (address)",
];

export async function resolveSmartAccount({ rpcUrl, factoryAddress, ownerEoa }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  if (!isAddress(factoryAddress)) {
    throw new Error("Invalid factory address");
  }
  if (!isAddress(ownerEoa)) {
    throw new Error("Invalid owner address");
  }
  const factoryAddr = getAddress(factoryAddress);
  const ownerAddr = getAddress(ownerEoa);
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
  const sender = await factory["getAddress(address,uint256)"](ownerAddr, 0n);
  const code = await provider.getCode(sender);
  const deployed = typeof code === "string" && code !== "0x";
  return { sender, deployed };
}
