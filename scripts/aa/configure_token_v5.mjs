import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function parseArgs(argv) {
  const out = { token: "", allowSend: null, allowFee: null, decimals: null, usd6PerWholeToken: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--token" && argv[i + 1]) {
      out.token = argv[i + 1];
      i += 1;
    } else if (arg === "--allow-send" && argv[i + 1]) {
      out.allowSend = argv[i + 1].toLowerCase() === "true";
      i += 1;
    } else if (arg === "--allow-fee" && argv[i + 1]) {
      out.allowFee = argv[i + 1].toLowerCase() === "true";
      i += 1;
    } else if (arg === "--decimals" && argv[i + 1]) {
      out.decimals = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--usd6PerWholeToken" && argv[i + 1]) {
      out.usd6PerWholeToken = BigInt(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

function loadAbi(jsonPath) {
  const raw = fs.readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed.abi;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.token) throw new Error("Missing --token");

  const rpcUrl = requireEnv("RPC_URL");
  const routerAddress = requireEnv("ROUTER");
  const paymasterAddress = requireEnv("PAYMASTER");
  const privateKey = (process.env.PRIVATE_KEY_DEPLOYER || process.env.PRIVATE_KEY_TEST_USER || "").trim();
  if (!privateKey) throw new Error("Missing PRIVATE_KEY_DEPLOYER (or PRIVATE_KEY_TEST_USER)");

  const routerAbiPath = path.join("out", "QuickPayV5Router.sol", "QuickPayV5Router.json");
  const paymasterAbiPath = path.join("out", "QuickPayV5Paymaster.sol", "QuickPayV5Paymaster.json");
  const routerAbi = loadAbi(routerAbiPath);
  const paymasterAbi = loadAbi(paymasterAbiPath);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const router = new ethers.Contract(routerAddress, routerAbi, signer);
  const paymaster = new ethers.Contract(paymasterAddress, paymasterAbi, signer);

  if (args.allowSend !== null) {
    const tx = await router.setTokenAllowed(args.token, args.allowSend);
    console.log(`SET_TOKEN_ALLOWED_TX=${tx.hash}`);
    await tx.wait(1);
  }

  if (args.allowFee !== null) {
    if (args.decimals === null || args.usd6PerWholeToken === null) {
      throw new Error("--allow-fee requires --decimals and --usd6PerWholeToken");
    }
    const tx = await paymaster.setFeeTokenConfig(
      args.token,
      args.allowFee,
      args.decimals,
      args.usd6PerWholeToken
    );
    console.log(`SET_FEE_TOKEN_CONFIG_TX=${tx.hash}`);
    await tx.wait(1);
  }

  const tokenAllowed = await router.tokenAllowed(args.token);
  const feeAllowed = await paymaster.feeTokenAllowed(args.token);
  const feeDecimals = await paymaster.feeTokenDecimals(args.token);
  const usd6PerWholeToken = await paymaster.usd6PerWholeToken(args.token);

  console.log("STATE_SUMMARY");
  console.log(`ROUTER_TOKEN_ALLOWED=${tokenAllowed}`);
  console.log(`PAYMASTER_FEE_TOKEN_ALLOWED=${feeAllowed}`);
  console.log(`PAYMASTER_FEE_TOKEN_DECIMALS=${feeDecimals}`);
  console.log(`PAYMASTER_USD6_PER_WHOLE_TOKEN=${usd6PerWholeToken}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
