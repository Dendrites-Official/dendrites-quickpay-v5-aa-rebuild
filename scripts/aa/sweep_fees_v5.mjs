import { ethers } from "ethers";

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

async function main() {
  // Hard-require env vars.
  const rpcUrl = requireEnv("RPC_URL");
  const pkDeployer = requireEnv("PRIVATE_KEY_DEPLOYER");
  requireEnv("FEEVAULT");
  const sweepTokensRaw = requireEnv("SWEEP_TOKENS");

  const feeCollectorRaw = String(process.env.FEE_COLLECTOR ?? "").trim();
  if (feeCollectorRaw !== "") {
    if (!ethers.isAddress(feeCollectorRaw)) {
      throw new Error(`Invalid FEE_COLLECTOR (must be a valid EVM address): ${feeCollectorRaw}`);
    }
    console.log(`FEE_COLLECTOR=${ethers.getAddress(feeCollectorRaw)}`);
  }

  const feeVaultAddr = requireEnv("FEEVAULT");
  if (!ethers.isAddress(feeVaultAddr)) {
    throw new Error(`Invalid FEEVAULT (must be a valid EVM address): ${feeVaultAddr}`);
  }
  const feeVaultAddress = ethers.getAddress(feeVaultAddr);

  const tokens = sweepTokensRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("SWEEP_TOKENS must contain at least one token address");
  }

  const seen = new Set();
  const sweepTokens = [];
  for (const t of tokens) {
    const token = t;
    if (!ethers.isAddress(token)) {
      throw new Error(`Invalid token address in SWEEP_TOKENS: ${token}`);
    }
    const norm = ethers.getAddress(token);
    if (seen.has(norm.toLowerCase())) continue;
    seen.add(norm.toLowerCase());
    sweepTokens.push(norm);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pkDeployer, provider);

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const feeVaultAbi = ["function sweepERC20(address token, uint256 amount)"];

  const feeVault = new ethers.Contract(feeVaultAddress, feeVaultAbi, signer);

  let sweptCount = 0;
  for (const token of sweepTokens) {
    const erc20 = new ethers.Contract(token, erc20Abi, provider);

    const balance = await erc20.balanceOf(feeVaultAddress);
    if (balance === 0n) continue;

    let decimals = 18;
    try {
      const d = await erc20.decimals();
      const asNum = Number(d);
      if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 255) {
        decimals = asNum;
      }
    } catch {
      decimals = 18;
    }

    const tx = await feeVault.sweepERC20(token, balance);
    await tx.wait();
    sweptCount += 1;

    console.log(`SWEPT token=${token} amount=${ethers.formatUnits(balance, decimals)}`);
  }

  console.log(`SWEEP_DONE tokens=${sweptCount}`);
}

main().catch((err) => {
  const msg = err?.shortMessage ?? err?.reason ?? err?.message ?? String(err);
  console.error(msg);
  process.exitCode = 1;
});
