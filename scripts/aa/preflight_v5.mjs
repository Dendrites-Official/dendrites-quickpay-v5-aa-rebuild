import { ethers } from "ethers";
import { getConfig } from "../lib/config.mjs";

function ceilDiv(a, b) {
  if (b === 0n) throw new Error("ceilDiv: division by zero");
  return a === 0n ? 0n : (a + b - 1n) / b;
}

function hexlify(value) {
  return ethers.toBeHex(value);
}

function toLower(addr) {
  return String(addr).toLowerCase();
}

function isHexString(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && v.length >= 2;
}

async function getPimlicoGasPrice(bundlerRpc) {
  const resp = await bundlerRpc.send("pimlico_getUserOperationGasPrice", []);
  const speedRaw = String(process.env.TX_SPEED ?? "eco").trim().toLowerCase();
  const isInstant = speedRaw === "instant";
  const pick = isInstant ? (resp?.fast ?? resp?.high) : resp?.standard;
  const maxFeePerGas = pick?.maxFeePerGas;
  const maxPriorityFeePerGas = pick?.maxPriorityFeePerGas;

  if (!isHexString(maxFeePerGas) || !isHexString(maxPriorityFeePerGas)) {
    throw new Error(`Invalid pimlico_getUserOperationGasPrice response: ${JSON.stringify(resp)}`);
  }

  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function main() {
  const cfg = getConfig();

  const publicRpc = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(cfg.bundlerUrl);
  const signer = new ethers.Wallet(cfg.keys.testUserPrivateKey, publicRpc);

  // 2) Sanity check bundler supports entrypoint
  const supported = await bundlerRpc.send("eth_supportedEntryPoints", []);
  const supportedLower = (supported || []).map((a) => toLower(a));
  if (!supportedLower.includes(toLower(cfg.addresses.entryPoint))) {
    throw new Error(
      `Bundler does not support entryPoint ${cfg.addresses.entryPoint}. Supported: ${JSON.stringify(supported)}`
    );
  }
  console.log("SUPPORTED_ENTRYPOINT_OK");

  // 3) Counterfactual sender + initCode
  const factoryAbi = [
    "function getAddress(address owner, uint256 salt) view returns (address)",
    "function createAccount(address owner, uint256 salt) returns (address)",
  ];
  const factory = new ethers.Contract(cfg.addresses.factory, factoryAbi, publicRpc);

  const owner = signer.address;
  const salt = 0n;
  // ethers.Contract has a built-in getAddress() helper that conflicts with the ABI function name.
  // Disambiguate by using the fully-qualified signature.
  const sender = await factory["getAddress(address,uint256)"](owner, salt);

  console.log(`USEROP_SENDER=${sender}`);

  // For EP v0.7, providing initCode (factory+factoryData) when the sender already has code will revert (AA10).
  // Only include factory fields when the account is not yet deployed.
  const senderCode = await publicRpc.getCode(sender);
  const senderDeployed = typeof senderCode === "string" && senderCode !== "0x";
  const factoryData = factory.interface.encodeFunctionData("createAccount", [owner, salt]);

  const speedRaw = String(process.env.TX_SPEED ?? "eco").trim().toLowerCase();
  const speed = speedRaw === "instant" ? 1 : 0;

  // 4) Inner router call + on-chain fee quote
  const routerAbi = [
    "function sendERC20Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee)",
  ];
  const router = new ethers.Contract(cfg.addresses.router, routerAbi, publicRpc);

  const amount = 1_000_000n; // 1.00 USDC (6 decimals) (must be >= fee when feeToken==token)

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ];
  const usdc = new ethers.Contract(cfg.addresses.usdc, erc20Abi, publicRpc);
  const [senderUsdcBal, senderAllowance] = await Promise.all([
    usdc.balanceOf(sender),
    usdc.allowance(sender, cfg.addresses.router),
  ]);
  console.log(`SENDER_USDC_BALANCE=${BigInt(senderUsdcBal)}`);
  console.log(`SENDER_USDC_ALLOWANCE_TO_ROUTER=${BigInt(senderAllowance)}`);

  const paymasterAbi = [
    "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
  ];
  const paymaster = new ethers.Contract(cfg.addresses.paymaster, paymasterAbi, publicRpc);

  const nowTs = Math.floor(Date.now() / 1000);
  const [baselineUsd6, surchargeUsd6, finalFeeUsd6, , maxFeeRequiredUsd6] = await paymaster.quoteFeeUsd6(
    sender,
    0,
    speed,
    nowTs
  );

  console.log(`QUOTE_BASELINE_USDC6=${BigInt(baselineUsd6)}`);
  console.log(`QUOTE_SURCHARGE_USDC6=${BigInt(surchargeUsd6)}`);
  console.log(`QUOTE_FINAL_FEE_USDC6=${BigInt(finalFeeUsd6)}`);
  console.log(`QUOTE_MAXFEE_REQUIRED_USDC6=${BigInt(maxFeeRequiredUsd6)}`);

  if (BigInt(senderUsdcBal) < amount) {
    throw new Error(`Insufficient USDC balance for preflight simulation. balance=${senderUsdcBal} amount=${amount}`);
  }
  if (BigInt(senderAllowance) < amount) {
    throw new Error(
      `Insufficient USDC allowance to ROUTER for preflight simulation. allowance=${senderAllowance} amount=${amount}. Run activate_approve_v5.mjs first.`
    );
  }

  const routerCallData = router.interface.encodeFunctionData("sendERC20Sponsored", [
    sender,
    cfg.addresses.usdc,
    signer.address,
    amount,
    cfg.addresses.usdc,
    BigInt(finalFeeUsd6),
  ]);

  // 5) SimpleAccount.execute(dest,value,func)
  const accountAbi = ["function execute(address dest,uint256 value,bytes func)"];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("execute", [cfg.addresses.router, 0n, routerCallData]);

  // 6) Build EP v0.7 UnpackedUserOperation schema (Pimlico)
  const verificationGasLimit = 300_000n;
  const callGasLimit = 500_000n;
  const preVerificationGas = 100_000n;

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPrice(bundlerRpc);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = now - 60n;
  const validUntil = now + 3600n;

  const mode = 0;
  const maxFeeRequired = BigInt(maxFeeRequiredUsd6);
  const overrideRaw = String(process.env.MAX_FEE_USDC6 ?? "").trim();
  const overrideMaxFee = overrideRaw ? BigInt(overrideRaw) : 0n;
  const maxFeeUsd6 = overrideMaxFee > 0n ? overrideMaxFee : maxFeeRequired;
  if (maxFeeUsd6 < maxFeeRequired) {
    throw new Error(`MAXFEE_USDC6 too low. required=${maxFeeRequired} got=${maxFeeUsd6}`);
  }

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const paymasterData = coder.encode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    [mode, speed, cfg.addresses.usdc, maxFeeUsd6, validUntil, validAfter]
  );

  // Pimlico recommended dummy signature for SimpleAccount
  const signature =
    "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";

  // Optional but useful: fetch current nonce from EntryPoint; if it fails, fall back to 0.
  let nonce = 0n;
  try {
    const entryPointAbi = ["function getNonce(address sender, uint192 key) view returns (uint256)"];
    const entryPoint = new ethers.Contract(cfg.addresses.entryPoint, entryPointAbi, publicRpc);
    nonce = await entryPoint.getNonce(sender, 0);
  } catch {
    nonce = 0n;
  }

  const userOp = {
    sender,
    nonce: hexlify(nonce),
    ...(senderDeployed ? {} : { factory: cfg.addresses.factory, factoryData }),
    callData,
    callGasLimit: hexlify(callGasLimit),
    verificationGasLimit: hexlify(verificationGasLimit),
    preVerificationGas: hexlify(preVerificationGas),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: cfg.addresses.paymaster,
    paymasterVerificationGasLimit: hexlify(200_000n),
    paymasterPostOpGasLimit: hexlify(200_000n),
    paymasterData,
    signature,
  };

  // Foolproof local assertions to avoid obvious bundler rejections
  if (!isHexString(userOp.maxFeePerGas) || !isHexString(userOp.maxPriorityFeePerGas)) {
    throw new Error("Invalid gas price fields: maxFeePerGas/maxPriorityFeePerGas must be hex strings");
  }
  if (toLower(userOp.sender) === toLower(cfg.addresses.factory)) {
    throw new Error("Invalid sender: sender must not be the factory address");
  }
  const executeSelector = accountIface.getFunction("execute").selector;
  if (typeof userOp.callData !== "string" || !userOp.callData.startsWith(executeSelector)) {
    throw new Error(`Invalid callData: must start with execute() selector ${executeSelector}`);
  }

  // 8) Bundler estimate
  try {
    const estimate = await bundlerRpc.send("eth_estimateUserOperationGas", [userOp, cfg.addresses.entryPoint]);
    console.log(JSON.stringify(estimate));
  } catch (err) {
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
