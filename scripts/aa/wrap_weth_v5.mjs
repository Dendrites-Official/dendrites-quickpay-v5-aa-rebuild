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

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error("Missing RPC_URL in .env");

const DEFAULT_WETH = "0x4200000000000000000000000000000000000006"; // Base Sepolia WETH9 (predeploy)
const WETH = arg("--weth", process.env.WETH || DEFAULT_WETH);

const pk =
  process.env.PRIVATE_KEY_TEST_USER ||
  process.env.PRIVATE_KEY_DEPLOYER ||
  "";
if (!pk || !pk.startsWith("0x") || pk.length < 66) {
  throw new Error("Missing PRIVATE_KEY_TEST_USER (or PRIVATE_KEY_DEPLOYER) in .env");
}

const amountEthStr = arg("--amount-eth", "0.0002");
const outPath = arg("--json-out", null);

const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
  "function balanceOf(address) view returns (uint256)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(pk, provider);
const owner = await wallet.getAddress();

const result = {
  ok: false,
  weth: WETH,
  owner,
  wrapAmountEth: amountEthStr,
  wrapValueWei: null,
  txHash: null,
  blockNumber: null,
  txValueWei: null,
  wethBalBeforeWei: null,
  wethBalAfterWei: null,
  wethMintedWei: null,
  wethContractEthBeforeWei: null,
  wethContractEthAfterWei: null,
  wethContractEthDeltaWei: null,
  depositEventFound: false,
  error: null,
};

try {
  const wrapValueWei = ethers.parseEther(amountEthStr);
  result.wrapValueWei = wrapValueWei.toString();

  const weth = new ethers.Contract(WETH, WETH_ABI, wallet);

  ux("WRAP_START", { weth: WETH, owner, wrapValueWei: result.wrapValueWei });

  const ownerEthBal = await provider.getBalance(owner);
  console.log("OWNER=", owner);
  console.log("OWNER_ETH_BAL_WEI=", ownerEthBal.toString());

  const wethBalBefore = await weth.balanceOf(owner);
  result.wethBalBeforeWei = wethBalBefore.toString();
  console.log("WETH_BAL_BEFORE_WEI=", result.wethBalBeforeWei);

  const wethEthBefore = await provider.getBalance(WETH);
  result.wethContractEthBeforeWei = wethEthBefore.toString();
  console.log("WETH_CONTRACT_ETH_BEFORE_WEI=", result.wethContractEthBeforeWei);

  // IMPORTANT: attach value here
  const tx = await weth.deposit({ value: wrapValueWei });
  result.txHash = tx.hash;
  ux("WRAP_TX_SENT", { txHash: tx.hash });

  const mined = await tx.wait();
  result.blockNumber = mined.blockNumber;

  const txOnchain = await provider.getTransaction(tx.hash);
  const txValueWei = txOnchain?.value ?? 0n;
  result.txValueWei = txValueWei.toString();
  console.log("TX_HASH=", tx.hash);
  console.log("MINED_BLOCK=", mined.blockNumber);
  console.log("TX_VALUE_WEI=", result.txValueWei);

  // Decode Deposit event if present
  for (const log of mined.logs || []) {
    if ((log.address || "").toLowerCase() !== WETH.toLowerCase()) continue;
    try {
      const parsed = weth.interface.parseLog(log);
      if (parsed?.name === "Deposit") {
        result.depositEventFound = true;
        ux("DEPOSIT_EVENT", {
          dst: parsed.args.dst,
          wad: parsed.args.wad.toString(),
        });
      }
    } catch {}
  }

  const b = mined.blockNumber;
  const beforeAtPrev = await weth.balanceOf(owner, { blockTag: b - 1 });
  const afterAtBlock = await weth.balanceOf(owner, { blockTag: b });

  console.log("WETH_BEFORE_AT_PREV_BLOCK_WEI=", beforeAtPrev.toString());
  console.log("WETH_AFTER_AT_MINED_BLOCK_WEI=", afterAtBlock.toString());
  console.log("WETH_MINTED_DELTA_WEI=", (afterAtBlock - beforeAtPrev).toString());

  const wethBalAfter = await weth.balanceOf(owner);
  result.wethBalAfterWei = wethBalAfter.toString();
  result.wethMintedWei = (afterAtBlock - beforeAtPrev).toString();

  const wethEthAfter = await provider.getBalance(WETH);
  result.wethContractEthAfterWei = wethEthAfter.toString();
  result.wethContractEthDeltaWei = (wethEthAfter - wethEthBefore).toString();

  console.log("WETH_BAL_AFTER_WEI=", result.wethBalAfterWei);
  console.log("WETH_MINTED_WEI=", result.wethMintedWei);
  console.log("WETH_CONTRACT_ETH_AFTER_WEI=", result.wethContractEthAfterWei);
  console.log("WETH_CONTRACT_ETH_DELTA_WEI=", result.wethContractEthDeltaWei);

  // “Can’t lie” assertions
  if (txValueWei === 0n) {
    throw new Error("TX sent 0 value. deposit() was called without ETH value.");
  }

  if (afterAtBlock - beforeAtPrev === 0n) {
    throw new Error("WETH minted delta is 0 even though tx had value. Investigate chain/owner/WETH address.");
  }

  result.ok = true;
  ux("WRAP_DONE", { ok: true, mintedWei: result.wethMintedWei });
} catch (e) {
  result.error = (e && e.message) ? e.message : String(e);
  ux("WRAP_DONE", { ok: false, error: result.error });
} finally {
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log("JSON_OUT=", outPath);
  }
  if (!result.ok) process.exitCode = 1;
}
