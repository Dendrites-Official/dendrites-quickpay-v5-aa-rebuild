import dotenv from "dotenv";
import { isAddress } from "ethers";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function requireChainId() {
  const raw = requireEnv("CHAIN_ID");
  const chainId = Number(raw);
  if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) {
    throw new Error(`Invalid CHAIN_ID (must be an integer): ${raw}`);
  }
  if (chainId !== 84532) {
    throw new Error(`Invalid CHAIN_ID (must equal 84532 for Base Sepolia): ${chainId}`);
  }
  return chainId;
}

function requireHttpUrl(name) {
  const url = requireEnv(name);
  if (!url.startsWith("http")) {
    throw new Error(`Invalid ${name} (must start with "http"): ${url}`);
  }
  return url;
}

function requireEvmAddress(name) {
  const addr = requireEnv(name);
  if (!isAddress(addr)) {
    throw new Error(`Invalid ${name} (must be a valid EVM address): ${addr}`);
  }
  return addr;
}

function requirePrivateKey(name) {
  const pk = requireEnv(name);
  if (!pk.startsWith("0x") || pk.length !== 66) {
    throw new Error(`Invalid ${name} (must be 0x-prefixed 32-byte hex, length 66)`);
  }
  return pk;
}

function parseFeeMode() {
  const raw = (process.env.FEE_MODE ?? "eco").trim().toLowerCase();
  if (raw !== "eco" && raw !== "instant") {
    throw new Error(`Invalid FEE_MODE (must be "eco" or "instant"): ${raw}`);
  }
  return raw;
}

function parseFeeTokenMode() {
  const raw = (process.env.FEE_TOKEN_MODE ?? "usdc").trim().toLowerCase();
  if (raw !== "usdc" && raw !== "same") {
    throw new Error(`Invalid FEE_TOKEN_MODE (must be "usdc" or "same"): ${raw}`);
  }
  return raw;
}

function parseFirstTxSurchargeEnabled() {
  const raw = (process.env.FIRST_TX_SURCHARGE_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function parseMaxFeeUsdc6() {
  const raw = (process.env.MAX_FEE_USDC6 ?? "").trim();
  if (raw === "") return null;

  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid MAX_FEE_USDC6 (must be integer >= 0 or empty): ${raw}`);
  }
  return n;
}

function parseAcceptanceLanes() {
  const raw = (process.env.ACCEPTANCE_LANES ?? "A,B,C,D").trim();
  const lanes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (lanes.length === 0) {
    throw new Error(`Invalid ACCEPTANCE_LANES (must contain at least one lane): ${raw}`);
  }

  return lanes;
}

function getConfig() {
  const chainId = requireChainId();

  const rpcUrl = requireHttpUrl("RPC_URL");
  const bundlerUrl = requireHttpUrl("BUNDLER_URL");

  const entryPoint = requireEvmAddress("ENTRYPOINT");
  const paymaster = requireEvmAddress("PAYMASTER");
  const router = requireEvmAddress("ROUTER");
  const factory = requireEvmAddress("FACTORY");
  const feeVault = requireEvmAddress("FEEVAULT");
  const feeCollector = requireEvmAddress("FEE_COLLECTOR");
  const usdc = requireEvmAddress("USDC");

  const testUserPrivateKey = requirePrivateKey("PRIVATE_KEY_TEST_USER");

  const mode = parseFeeMode();
  const tokenMode = parseFeeTokenMode();
  const firstTxSurchargeEnabled = parseFirstTxSurchargeEnabled();
  const maxFeeUsdc6 = parseMaxFeeUsdc6();

  const lanes = parseAcceptanceLanes();

  return {
    chainId,
    rpcUrl,
    bundlerUrl,
    addresses: {
      entryPoint,
      paymaster,
      router,
      factory,
      feeVault,
      feeCollector,
      usdc,
    },
    keys: {
      testUserPrivateKey,
    },
    fee: {
      mode,
      tokenMode,
      firstTxSurchargeEnabled,
      maxFeeUsdc6,
    },
    acceptance: {
      lanes,
    },
  };
}

export { getConfig };
