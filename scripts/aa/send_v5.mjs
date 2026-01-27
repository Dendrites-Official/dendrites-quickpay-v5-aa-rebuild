import { ethers } from "ethers";
import { getConfig } from "../lib/config.mjs";

function hexlify(value) {
  return ethers.toBeHex(value);
}

function toLower(addr) {
  return String(addr).toLowerCase();
}

function isHexString(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && v.length >= 2;
}

function ceilDiv(a, b) {
  if (b === 0n) throw new Error("ceilDiv: division by zero");
  return a === 0n ? 0n : (a + b - 1n) / b;
}

async function getPimlicoGasPriceStandard(bundlerRpc) {
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

function packUint128Pair(high, low) {
  const hi = ethers.zeroPadValue(ethers.toBeHex(high), 16);
  const lo = ethers.zeroPadValue(ethers.toBeHex(low), 16);
  return ethers.hexlify(ethers.concat([hi, lo]));
}

function packInitCode(factory, factoryData) {
  return ethers.hexlify(ethers.concat([ethers.getBytes(factory), ethers.getBytes(factoryData)]));
}

function packPaymasterAndData(paymaster, paymasterVerificationGasLimit, paymasterPostOpGasLimit, paymasterData) {
  const pm = ethers.getBytes(paymaster);
  const vgl = ethers.zeroPadValue(ethers.toBeHex(paymasterVerificationGasLimit), 16);
  const pgl = ethers.zeroPadValue(ethers.toBeHex(paymasterPostOpGasLimit), 16);
  const data = ethers.getBytes(paymasterData);
  return ethers.hexlify(ethers.concat([pm, vgl, pgl, data]));
}

async function getNonce(publicRpc, entryPoint, sender) {
  const entryPointAbi = ["function getNonce(address sender, uint192 key) view returns (uint256)"];
  const ep = new ethers.Contract(entryPoint, entryPointAbi, publicRpc);
  return await ep.getNonce(sender, 0);
}

async function getUserOpHash(publicRpc, entryPoint, packedUserOp) {
  const entryPointAbi = [
    "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  ];
  const ep = new ethers.Contract(entryPoint, entryPointAbi, publicRpc);
  return await ep.getUserOpHash(packedUserOp);
}

async function main() {
  const cfg = getConfig();

  const publicRpc = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const bundlerRpc = new ethers.JsonRpcProvider(cfg.bundlerUrl);
  const signer = new ethers.Wallet(cfg.keys.testUserPrivateKey, publicRpc);

  // 1) Sanity check bundler supports entrypoint
  const supported = await bundlerRpc.send("eth_supportedEntryPoints", []);
  const supportedLower = (supported || []).map((a) => toLower(a));
  if (!supportedLower.includes(toLower(cfg.addresses.entryPoint))) {
    throw new Error(
      `Bundler does not support entryPoint ${cfg.addresses.entryPoint}. Supported: ${JSON.stringify(supported)}`
    );
  }
  console.log("SUPPORTED_ENTRYPOINT_OK");

  // 2) Counterfactual sender + optional init fields
  const factoryAbi = [
    "function getAddress(address owner, uint256 salt) view returns (address)",
    "function createAccount(address owner, uint256 salt) returns (address)",
  ];
  const factory = new ethers.Contract(cfg.addresses.factory, factoryAbi, publicRpc);

  const owner = signer.address;
  const salt = 0n;
  const sender = await factory["getAddress(address,uint256)"](owner, salt);
  console.log(`USEROP_SENDER=${ethers.getAddress(sender)}`);

  const senderCode = await publicRpc.getCode(sender);
  const senderDeployed = typeof senderCode === "string" && senderCode !== "0x";

  const factoryData = factory.interface.encodeFunctionData("createAccount", [owner, salt]);

  const speedRaw = String(process.env.TX_SPEED ?? "eco").trim().toLowerCase();
  const txSpeed = speedRaw === "instant" ? "instant" : "eco";
  const speed = txSpeed === "instant" ? 1 : 0;
  console.log(`TX_SPEED=${txSpeed}`);

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

  console.log(`FEE_BASELINE_USDC6=${BigInt(baselineUsd6)}`);
  console.log(`FEE_SURCHARGE_USDC6=${BigInt(surchargeUsd6)}`);
  console.log(`FINAL_FEE_USDC6=${BigInt(finalFeeUsd6)}`);
  console.log(`MAXFEE_REQUIRED_USDC6=${BigInt(maxFeeRequiredUsd6)}`);

  if (BigInt(finalFeeUsd6) <= 0n) {
    throw new Error("Invalid finalFeeUsd6: must be > 0");
  }

  // 3) Build callData = SimpleAccount.execute(ROUTER, 0, sendERC20Sponsored(...))
  const routerAbi = [
    "function sendERC20Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee)",
  ];
  const router = new ethers.Contract(cfg.addresses.router, routerAbi, publicRpc);

  const amount = BigInt(process.env.SEND_AMOUNT_USDC6 ?? "1000000");

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

  if (BigInt(senderUsdcBal) < amount) {
    throw new Error(`Insufficient USDC balance for SEND. balance=${senderUsdcBal} amount=${amount}`);
  }
  if (BigInt(senderAllowance) < amount) {
    throw new Error(
      `Insufficient USDC allowance to ROUTER for SEND. allowance=${senderAllowance} amount=${amount}. Run activate_approve_v5.mjs first.`
    );
  }

  const maxFeeRequired = BigInt(maxFeeRequiredUsd6);
  const overrideRaw = String(process.env.MAX_FEE_USDC6 ?? "").trim();
  const overrideMaxFee = overrideRaw ? BigInt(overrideRaw) : 0n;
  const maxFeeUsd6 = overrideMaxFee > 0n ? overrideMaxFee : maxFeeRequired;
  if (maxFeeUsd6 < maxFeeRequired) {
    throw new Error(`MAXFEE_USDC6 too low. required=${maxFeeRequired} got=${maxFeeUsd6}`);
  }

  const routerCallData = router.interface.encodeFunctionData("sendERC20Sponsored", [
    sender,
    cfg.addresses.usdc,
    signer.address,
    amount,
    cfg.addresses.usdc,
    BigInt(finalFeeUsd6),
  ]);

  const accountAbi = ["function execute(address dest,uint256 value,bytes func)"];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("execute", [cfg.addresses.router, 0n, routerCallData]);

  // 4) Gas price from Pimlico (standard)
  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPriceStandard(bundlerRpc);

  // 5) PaymasterData (mode=0 SEND)
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = now - 60n;
  const validUntil = now + 3600n;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const mode = 0;
  const paymasterData = coder.encode(
    ["uint8", "uint8", "address", "uint256", "uint48", "uint48"],
    [mode, speed, cfg.addresses.usdc, maxFeeUsd6, validUntil, validAfter]
  );

  const nonce = await getNonce(publicRpc, cfg.addresses.entryPoint, sender);

  // 6) Build UnpackedUserOperation (Pimlico schema) with dummy signature for estimation
  const dummySignature =
    "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";

  const userOp = {
    sender,
    nonce: hexlify(nonce),
    ...(senderDeployed ? {} : { factory: cfg.addresses.factory, factoryData }),
    callData,
    callGasLimit: hexlify(500_000n),
    verificationGasLimit: hexlify(300_000n),
    preVerificationGas: hexlify(100_000n),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: cfg.addresses.paymaster,
    paymasterVerificationGasLimit: hexlify(200_000n),
    paymasterPostOpGasLimit: hexlify(200_000n),
    paymasterData,
    signature: dummySignature,
  };

  // 7) Strict local checks before estimate
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

  // Strict sanity: decode callData and assert it contains the expected finalFeeUsd6
  const decodedExecute = accountIface.decodeFunctionData("execute", userOp.callData);
  const decodedDest = decodedExecute[0];
  const decodedValue = decodedExecute[1];
  const decodedInner = decodedExecute[2];
  if (toLower(decodedDest) !== toLower(cfg.addresses.router)) {
    throw new Error(`Invalid execute dest: expected ROUTER ${cfg.addresses.router}, got ${decodedDest}`);
  }
  if (BigInt(decodedValue) !== 0n) {
    throw new Error(`Invalid execute value: expected 0, got ${decodedValue}`);
  }
  const decodedRouter = router.interface.decodeFunctionData("sendERC20Sponsored", decodedInner);
  const decodedFinalFee = BigInt(decodedRouter[5]);
  if (decodedFinalFee !== finalFeeUsd6) {
    throw new Error(`Invalid finalFee in callData: expected ${finalFeeUsd6}, got ${decodedFinalFee}`);
  }

  // 8) Estimate via bundler
  const estimate = await bundlerRpc.send("eth_estimateUserOperationGas", [userOp, cfg.addresses.entryPoint]);

  userOp.callGasLimit = estimate.callGasLimit;
  userOp.verificationGasLimit = estimate.verificationGasLimit;
  userOp.preVerificationGas = estimate.preVerificationGas;
  userOp.paymasterVerificationGasLimit = estimate.paymasterVerificationGasLimit;
  userOp.paymasterPostOpGasLimit = estimate.paymasterPostOpGasLimit;

  // 9) Compute on-chain userOpHash (PackedUserOperation) using the final gas fields
  const initCode = senderDeployed ? "0x" : packInitCode(cfg.addresses.factory, factoryData);
  const accountGasLimits = packUint128Pair(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
  const gasFees = packUint128Pair(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
  const paymasterAndData = packPaymasterAndData(
    cfg.addresses.paymaster,
    BigInt(userOp.paymasterVerificationGasLimit),
    BigInt(userOp.paymasterPostOpGasLimit),
    paymasterData
  );

  const packedForHash = {
    sender,
    nonce,
    initCode,
    callData,
    accountGasLimits,
    preVerificationGas: BigInt(userOp.preVerificationGas),
    gasFees,
    paymasterAndData,
    signature: "0x",
  };

  const userOpHash = await getUserOpHash(publicRpc, cfg.addresses.entryPoint, packedForHash);

  // 10) Sign raw digest (NO EIP-191 prefix)
  userOp.signature = signer.signingKey.sign(userOpHash).serialized;

  console.log(`USEROP_HASH=${userOpHash}`);

  // 11) Send to bundler
  const bundlerResult = await bundlerRpc.send("eth_sendUserOperation", [userOp, cfg.addresses.entryPoint]);
  console.log(`SENT_USEROP=${bundlerResult}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
