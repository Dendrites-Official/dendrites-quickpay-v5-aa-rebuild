import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return def;
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

function ux(type, extra = {}) {
  console.log(`UX_EVENT=${JSON.stringify({ ts: nowIso(), type, ...extra })}`);
}

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

async function main() {
  const outPath = arg("--json-out", null);
  const tokenArg = arg("--token", process.env.TOKEN || "");
  if (!tokenArg) throw new Error("Missing --token (or TOKEN env)");
  const token = tokenArg.trim();

  const rpcUrl = requireEnv("RPC_URL");
  const permit2 = (process.env.PERMIT2 || "0x000000000022D473030F116dDEE9F6B43aC78BA3").trim();
  const router = requireEnv("ROUTER");

  const pk =
    process.env.PRIVATE_KEY_OWNER ||
    process.env.PRIVATE_KEY_TEST_USER ||
    "";
  if (!pk || !pk.startsWith("0x") || pk.length < 66) {
    throw new Error("Missing PRIVATE_KEY_OWNER or PRIVATE_KEY_TEST_USER in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const owner = await wallet.getAddress();

  const result = {
    ok: false,
    token,
    permit2,
    router,
    owner,
    tokenApproveTxHash: "",
    permit2ApproveTxHash: "",
    error: null,
  };

  ux("SETUP_START", { token, permit2, router, owner });

  const erc20Abi = [
    "function approve(address spender, uint256 value) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ];
  const permit2Abi = [
    "function approve(address token,address spender,uint160 amount,uint48 expiration)",
    "function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)",
  ];

  const tokenContract = new ethers.Contract(token, erc20Abi, provider);
  const permit2Contract = new ethers.Contract(permit2, permit2Abi, provider);

  const maxUint160 = (1n << 160n) - 1n;
  const maxUint48 = (1n << 48n) - 1n;

  const allowanceErc20 = await tokenContract.allowance(owner, permit2);
  if (BigInt(allowanceErc20) > 0n) {
    ux("TOKEN_APPROVE_SKIPPED", { allowance: allowanceErc20.toString() });
  } else {
    const tokenWithSigner = tokenContract.connect(wallet);
    const tx = await tokenWithSigner.approve(permit2, ethers.MaxUint256);
    result.tokenApproveTxHash = tx.hash;
    ux("TOKEN_APPROVE_SENT", { txHash: tx.hash });
    const rec = await tx.wait();
    ux("TOKEN_APPROVE_CONFIRMED", { txHash: tx.hash, blockNumber: rec.blockNumber });
  }

  const [permit2Amount, permit2Exp] = await permit2Contract.allowance(owner, token, router);
  if (BigInt(permit2Amount) >= maxUint160 / 2n && BigInt(permit2Exp) >= maxUint48 / 2n) {
    ux("PERMIT2_APPROVE_SKIPPED", { amount: permit2Amount.toString(), expiration: permit2Exp.toString() });
  } else {
    const permit2WithSigner = permit2Contract.connect(wallet);
    const tx = await permit2WithSigner.approve(token, router, maxUint160, maxUint48);
    result.permit2ApproveTxHash = tx.hash;
    ux("PERMIT2_APPROVE_SENT", { txHash: tx.hash });
    const rec = await tx.wait();
    ux("PERMIT2_APPROVE_CONFIRMED", { txHash: tx.hash, blockNumber: rec.blockNumber });
  }

  result.ok = true;
  ux("SETUP_DONE", { ok: true });

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`JSON_OUT=${outPath}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    const outPath = arg("--json-out", null);
    if (outPath) {
      const errorResult = {
        ok: false,
        error: err?.message || String(err),
      };
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(errorResult, null, 2));
      console.log(`JSON_OUT=${outPath}`);
    }
    process.exitCode = 1;
  });
