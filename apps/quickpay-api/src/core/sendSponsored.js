import { ethers } from "ethers";
import { getQuote } from "./quote.js";

function mustEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function isAddr(x) {
  return typeof x === "string" && ethers.isAddress(x.trim());
}

export async function sendSponsored({
  chainId,
  rpcUrl,
  bundlerUrl,
  entryPoint,
  router,
  paymaster,
  factory,
  feeVault,
  ownerEoa,
  token,
  to,
  amount,
  feeMode,
  speed,
  auth,
}) {
  const routerAddr = String(router || process.env.ROUTER || "").trim();
  const owner = String(ownerEoa || "").trim();
  const tokenAddr = String(token || "").trim();
  const toAddr = String(to || "").trim();
  const amt = String(amount || "").trim();
  const rpc = String(rpcUrl || process.env.RPC_URL || "").trim();

  if (![84532, "84532"].includes(chainId)) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
  for (const [k, v] of [
    ["router", routerAddr],
    ["ownerEoa", owner],
    ["token", tokenAddr],
    ["to", toAddr],
  ]) {
    if (!isAddr(v)) throw new Error(`Invalid ${k} address: "${v}"`);
  }
  if (!/^\d+$/.test(amt)) throw new Error(`Invalid amount (must be uint string): "${amt}"`);

  if (!auth || auth.type !== "EIP3009") {
    throw new Error(`Missing/invalid auth. Expected auth.type="EIP3009"`);
  }

  const q = await getQuote({
    chainId,
    rpcUrl: rpc,
    bundlerUrl,
    entryPoint,
    router: routerAddr,
    paymaster: paymaster || process.env.PAYMASTER,
    factoryAddress: factory || process.env.FACTORY,
    feeVault: feeVault || process.env.FEEVAULT,
    ownerEoa: owner,
    token: tokenAddr,
    amount: amt,
    feeMode,
    speed,
  });

  if (q.lane !== "EIP3009") {
    throw new Error(`Unsupported lane for this send endpoint: ${q.lane}`);
  }

  if (String(auth.from || "").toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`auth.from mismatch`);
  }
  if (String(auth.to || "").toLowerCase() !== routerAddr.toLowerCase()) {
    throw new Error(`auth.to mismatch (must be router)`);
  }
  if (String(auth.value || "") !== amt) {
    throw new Error(`auth.value mismatch`);
  }

  const sig = ethers.Signature.from(String(auth.signature));
  const nonce = String(auth.nonce);
  const validAfter = String(auth.validAfter || "0");
  const validBefore = String(auth.validBefore || "0");

  const relayerPk = mustEnv("RELAYER_PRIVATE_KEY");
  const provider = new ethers.JsonRpcProvider(rpc);
  const relayer = new ethers.Wallet(relayerPk, provider);

  const routerAbi = [
    "function sendERC20EIP3009Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee,address owner,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
  ];
  const routerC = new ethers.Contract(routerAddr, routerAbi, relayer);

  const tx = await routerC.sendERC20EIP3009Sponsored(
    owner,
    tokenAddr,
    toAddr,
    amt,
    tokenAddr,
    q.feeTokenAmount,
    owner,
    validAfter,
    validBefore,
    nonce,
    sig.v,
    sig.r,
    sig.s
  );

  return {
    ok: true,
    lane: q.lane,
    txHash: tx.hash,
    feeUsd6: q.feeUsd6,
    maxFeeUsd6: q.maxFeeUsd6 ?? null,
    feeTokenAmount: q.feeTokenAmount,
  };
}
