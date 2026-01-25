import { ethers } from "ethers";
import { getConfig } from "../lib/config.mjs";

function hexlify(value) {
  return ethers.toBeHex(value);
}

function isHexString(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && v.length >= 2;
}

function toLower(addr) {
  return String(addr).toLowerCase();
}

async function getPimlicoGasPrice(bundlerRpc) {
  const resp = await bundlerRpc.send("pimlico_getUserOperationGasPrice", []);
  const pick = resp?.standard ?? resp?.fast ?? resp?.slow;
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
  try {
    const entryPointAbi = ["function getNonce(address sender, uint192 key) view returns (uint256)"];
    const ep = new ethers.Contract(entryPoint, entryPointAbi, publicRpc);
    return await ep.getNonce(sender, 0);
  } catch {
    return 0n;
  }
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

  const supported = await bundlerRpc.send("eth_supportedEntryPoints", []);
  const supportedLower = (supported || []).map((a) => toLower(a));
  if (!supportedLower.includes(toLower(cfg.addresses.entryPoint))) {
    throw new Error(
      `Bundler does not support entryPoint ${cfg.addresses.entryPoint}. Supported: ${JSON.stringify(supported)}`
    );
  }

  const factoryAbi = [
    "function getAddress(address owner, uint256 salt) view returns (address)",
    "function createAccount(address owner, uint256 salt) returns (address)",
  ];
  const factory = new ethers.Contract(cfg.addresses.factory, factoryAbi, publicRpc);

  const owner = signer.address;
  const salt = 0n;
  const sender = await factory["getAddress(address,uint256)"](owner, salt);

  console.log(`ACTIVATE_SENDER=${sender}`);

  const factoryData = factory.interface.encodeFunctionData("createAccount", [owner, salt]);

  const erc20Abi = ["function approve(address spender, uint256 value) returns (bool)"];
  const usdc = new ethers.Contract(cfg.addresses.usdc, erc20Abi, publicRpc);
  const approveData = usdc.interface.encodeFunctionData("approve", [cfg.addresses.router, ethers.MaxUint256]);

  const accountAbi = ["function execute(address dest,uint256 value,bytes func)"];
  const accountIface = new ethers.Interface(accountAbi);
  const callData = accountIface.encodeFunctionData("execute", [cfg.addresses.usdc, 0n, approveData]);

  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGasPrice(bundlerRpc);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = now - 60n;
  const validUntil = now + 3600n;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const mode = 1;
  const maxFeeUsd6 = 0n;
  const paymasterData = coder.encode(
    ["uint8", "address", "uint256", "uint48", "uint48"],
    [mode, cfg.addresses.usdc, maxFeeUsd6, validUntil, validAfter]
  );

  const nonce = await getNonce(publicRpc, cfg.addresses.entryPoint, sender);

  // Start with sane defaults, then estimate and re-sign with the final gas fields.
  const gasDefaults = {
    callGasLimit: 200_000n,
    verificationGasLimit: 350_000n,
    preVerificationGas: 100_000n,
    paymasterVerificationGasLimit: 200_000n,
    paymasterPostOpGasLimit: 200_000n,
  };

  let userOp = {
    sender,
    nonce: hexlify(nonce),
    factory: cfg.addresses.factory,
    factoryData,
    callData,
    callGasLimit: hexlify(gasDefaults.callGasLimit),
    verificationGasLimit: hexlify(gasDefaults.verificationGasLimit),
    preVerificationGas: hexlify(gasDefaults.preVerificationGas),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: cfg.addresses.paymaster,
    paymasterVerificationGasLimit: hexlify(gasDefaults.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: hexlify(gasDefaults.paymasterPostOpGasLimit),
    paymasterData,
    signature: "0x",
  };

  const signWithGasFields = async () => {
    const initCode = packInitCode(cfg.addresses.factory, factoryData);
    const accountGasLimits = packUint128Pair(
      BigInt(userOp.verificationGasLimit),
      BigInt(userOp.callGasLimit)
    );
    const gasFees = packUint128Pair(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    const paymasterAndData = packPaymasterAndData(
      cfg.addresses.paymaster,
      BigInt(userOp.paymasterVerificationGasLimit),
      BigInt(userOp.paymasterPostOpGasLimit),
      paymasterData
    );

    const packed = {
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

    const userOpHash = await getUserOpHash(publicRpc, cfg.addresses.entryPoint, packed);
    // Sign the raw digest (no EIP-191 prefix). This matches SimpleAccount variants that recover directly on userOpHash.
    userOp.signature = signer.signingKey.sign(userOpHash).serialized;
    return userOpHash;
  };

  // First signature so estimate can simulate SimpleAccount validation.
  await signWithGasFields();

  const estimate = await bundlerRpc.send("eth_estimateUserOperationGas", [userOp, cfg.addresses.entryPoint]);

  userOp.callGasLimit = estimate.callGasLimit ?? userOp.callGasLimit;
  userOp.verificationGasLimit = estimate.verificationGasLimit ?? userOp.verificationGasLimit;
  userOp.preVerificationGas = estimate.preVerificationGas ?? userOp.preVerificationGas;
  userOp.paymasterVerificationGasLimit = estimate.paymasterVerificationGasLimit ?? userOp.paymasterVerificationGasLimit;
  userOp.paymasterPostOpGasLimit = estimate.paymasterPostOpGasLimit ?? userOp.paymasterPostOpGasLimit;

  const finalHash = await signWithGasFields();
  console.log(`ACTIVATE_USEROP_HASH=${finalHash}`);

  const bundlerHash = await bundlerRpc.send("eth_sendUserOperation", [userOp, cfg.addresses.entryPoint]);
  console.log(`TX_SENT_USEROP=${bundlerHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
