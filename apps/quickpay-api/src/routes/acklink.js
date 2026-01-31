import { Contract, JsonRpcProvider, isAddress, ethers } from "ethers";
import { sendAcklinkSponsored } from "../core/acklinkSponsored.js";

const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const ACKLINK_NONCE_ABI = ["function nonces(address sender) view returns (uint256)"];

const FEE_USDC6_ECO = 200000n;
const FEE_USDC6_INSTANT = 300000n;

function parseHexBytes32(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function buildMetaHash(meta) {
  const payload = JSON.stringify({
    name: meta?.name ?? null,
    message: meta?.message ?? null,
    reason: meta?.reason ?? null,
  });
  return ethers.keccak256(ethers.toUtf8Bytes(payload));
}

function getAckTimeoutMs() {
  const raw = Number(process.env.ACK_TIMEOUT_MS ?? 30000);
  return Number.isFinite(raw) && raw > 0 ? raw : 30000;
}

function getAckEdgeTimeoutMs() {
  const raw = Number(process.env.ACK_EDGE_TIMEOUT_MS ?? 10000);
  return Number.isFinite(raw) && raw > 0 ? raw : 10000;
}

function getAckConfig() {
  const usdc = String(process.env.USDC || "").trim();
  const feeVault = String(process.env.FEEVAULT || "").trim();
  const acklinkVault = String(process.env.ACKLINK_VAULT || "").trim();
  const factory = String(process.env.FACTORY || "").trim();
  const bundlerUrl = String(process.env.BUNDLER_URL || "").trim();

  if (!usdc || !isAddress(usdc)) throw new Error("Missing USDC");
  if (!feeVault || !isAddress(feeVault)) throw new Error("Missing FEEVAULT");
  if (!acklinkVault || !isAddress(acklinkVault)) throw new Error("Missing ACKLINK_VAULT");
  if (!factory || !isAddress(factory)) throw new Error("Missing FACTORY");
  if (!bundlerUrl) throw new Error("Missing BUNDLER_URL");

  return {
    usdc,
    feeVault,
    acklinkVault,
    factory,
    bundlerUrl,
  };
}

function parseSpeed(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "eco") return { label: "eco", speed: 0, feeUsdc6: FEE_USDC6_ECO };
  if (normalized === "instant") return { label: "instant", speed: 1, feeUsdc6: FEE_USDC6_INSTANT };
  return null;
}

function isoFromSeconds(value) {
  return new Date(Number(value) * 1000).toISOString();
}

export function registerAckLinkRoutes(app, {
  supabase,
  resolveRpcUrl,
  resolveSmartAccount,
  withTimeout,
  getRpcTimeoutMs,
  callQuickpayReceipt,
  callQuickpayNote,
  recordSponsorshipCost,
  enforceAckRateLimit,
  createLogger,
}) {
  app.post("/acklink/create", async (request, reply) => {
    const reqId = request?.reqId;
    const logger = createLogger({ reqId });
    const ackTimeoutMs = getAckTimeoutMs();
    const ackEdgeTimeoutMs = getAckEdgeTimeoutMs();

    try {
      const result = await withTimeout(
        (async () => {
          const body = request.body ?? {};
          const from = String(body?.from || "").trim();
          const amountRaw = String(body?.amountUsdc6 || "").trim();
          const speedInput = body?.speed;
          const name = body?.name ?? null;
          const message = body?.message ?? null;
          const reason = body?.reason ?? null;
          const note = body?.note ?? null;
          const noteSignature = body?.noteSignature ?? null;
          const noteSender = body?.noteSender ?? null;
          const userOpSignature = body?.userOpSignature ?? null;
          const userOpDraft = body?.userOpDraft ?? null;

          if (!from || !isAddress(from)) {
            return reply.code(400).send({ ok: false, code: "INVALID_SENDER", reqId });
          }

          const limited = enforceAckRateLimit(request, reply, from);
          if (limited) return limited;

          if (!amountRaw || !/^\d+$/.test(amountRaw)) {
            return reply.code(400).send({ ok: false, code: "INVALID_AMOUNT", reqId });
          }

          const amountUsdc6 = BigInt(amountRaw);
          if (amountUsdc6 <= 0n) {
            return reply.code(400).send({ ok: false, code: "INVALID_AMOUNT", reqId });
          }

          const speedResolved = parseSpeed(speedInput);
          if (!speedResolved) {
            return reply.code(400).send({ ok: false, code: "INVALID_SPEED", reqId });
          }

          const feeUsdc6 = speedResolved.feeUsdc6;
          const expiresSec = Number(process.env.ACKLINK_EXPIRES_SEC ?? 86400);
          const expiresAt = Math.floor(Date.now() / 1000) + (Number.isFinite(expiresSec) ? expiresSec : 86400);

          const { usdc, feeVault, acklinkVault, factory, bundlerUrl } = getAckConfig();
          const chainId = Number(process.env.CHAIN_ID ?? 84532);

          const resolvedRpcUrl = await resolveRpcUrl({
            rpcUrl: process.env.RPC_URL,
            bundlerUrl: process.env.BUNDLER_URL,
            chainId,
          });

          const smart = await resolveSmartAccount({
            rpcUrl: resolvedRpcUrl,
            factoryAddress: factory,
            factorySource: "env.FACTORY",
            ownerEoa: from,
          });

          const provider = new JsonRpcProvider(resolvedRpcUrl);
          const erc20 = new Contract(usdc, ERC20_BALANCE_ABI, provider);
          const balance = await withTimeout(erc20.balanceOf(smart.sender), getRpcTimeoutMs(), {
            code: "RPC_TIMEOUT",
            status: 504,
            where: "acklink.balance",
            message: "RPC timeout",
          });

          const totalNeeded = amountUsdc6 + feeUsdc6;
          if (BigInt(balance ?? 0n) < totalNeeded) {
            return reply.code(400).send({
              ok: false,
              code: "INSUFFICIENT_BALANCE",
              needUsdc6: totalNeeded.toString(),
              haveUsdc6: String(balance ?? 0),
              reqId,
            });
          }

          const acklinkContract = new Contract(acklinkVault, ACKLINK_NONCE_ABI, provider);
          const nonce = await withTimeout(acklinkContract.nonces(smart.sender), getRpcTimeoutMs(), {
            code: "RPC_TIMEOUT",
            status: 504,
            where: "acklink.nonce",
            message: "RPC timeout",
          });

          const metaHash = buildMetaHash({ name, message, reason });
          const linkId = ethers.solidityPackedKeccak256(
            ["address", "uint256", "uint64", "bytes32", "uint256", "uint256", "address"],
            [smart.sender, amountUsdc6, BigInt(expiresAt), metaHash, BigInt(nonce ?? 0), BigInt(chainId), acklinkVault]
          );

          const laneResult = await sendAcklinkSponsored({
            action: "CREATE",
            chainId,
            rpcUrl: resolvedRpcUrl,
            bundlerUrl,
            ownerEoa: from,
            speed: speedResolved.speed,
            amountUsdc6: amountUsdc6.toString(),
            feeUsdc6: feeUsdc6.toString(),
            expiresAt,
            metaHash,
            userOpSignature,
            userOpDraft,
          });

          if (laneResult?.needsUserOpSignature === true) {
            return reply.send({ reqId, ...laneResult });
          }

          const txHash = laneResult?.txHash ?? null;
          const userOpHash = laneResult?.userOpHash ?? null;

          await supabase.from("ack_links").insert({
            link_id: linkId,
            sender: String(smart.sender).toLowerCase(),
            token: "USDC",
            amount_usdc6: amountUsdc6.toString(),
            fee_usdc6: feeUsdc6.toString(),
            speed: speedResolved.label,
            status: "CREATED",
            expires_at: isoFromSeconds(expiresAt),
            meta: { name, message, reason },
            tx_hash_create: txHash,
            user_op_hash_create: userOpHash,
            updated_at: new Date().toISOString(),
          });

          const totalDebited = (amountUsdc6 + feeUsdc6).toString();
          const receiptPayload = {
            chainId,
            userOpHash,
            txHash,
            from,
            sender: smart.sender,
            ownerEoa: from,
            token: usdc,
            mode: "SPONSORED",
            feeMode: "plusFee",
            totalEntered: amountUsdc6.toString(),
            feeAmount: feeUsdc6.toString(),
            totalDebited,
            name,
            message,
            reason,
            to: acklinkVault,
            route: "acklink_create",
            meta: {
              kind: "AckLink Created",
              route: "acklink_create",
              linkId,
              expiresAt: isoFromSeconds(expiresAt),
              speed: speedResolved.label,
              feeUsdc6: feeUsdc6.toString(),
              amountUsdc6: amountUsdc6.toString(),
              acklinkVault,
              feeVault,
              name,
              message,
              reason,
            },
          };

          const receiptResponse = await withTimeout(callQuickpayReceipt(receiptPayload, { reqId }), ackEdgeTimeoutMs, {
            code: "EDGE_TIMEOUT",
            status: 504,
            where: "acklink.receipt",
            message: "Receipt timeout",
          });

          const receiptId = receiptResponse?.receiptId ?? receiptResponse?.receipt_id ?? null;

          if (note && noteSignature && noteSender && receiptId) {
            await withTimeout(
              callQuickpayNote({
                receiptId,
                sender: noteSender,
                note,
                signature: noteSignature,
                chainId,
                reqId,
              }),
              ackEdgeTimeoutMs,
              {
                code: "EDGE_TIMEOUT",
                status: 504,
                where: "acklink.note",
                message: "Note timeout",
              }
            );
          }

          const ethSponsoredWei = txHash
            ? await recordSponsorshipCost({
                reqId,
                route: "acklink_create",
                txHash,
                userOpHash,
                chainId,
                meta: { linkId, speed: speedResolved.label },
              })
            : null;

          return reply.send({
            ok: true,
            reqId,
            linkId,
            expiresAt: isoFromSeconds(expiresAt),
            txHash,
            userOpHash,
            receiptId,
            feeUsdc6: feeUsdc6.toString(),
            ...(ethSponsoredWei ? { ethSponsoredWei } : {}),
          });
        })(),
        ackTimeoutMs,
        { code: "TIMEOUT", status: 504, where: "acklink.create", message: "ACKLINK_TIMEOUT" }
      );
      return result;
    } catch (err) {
      if (err?.code === "TIMEOUT") {
        return reply.code(504).send({ ok: false, code: "TIMEOUT", reqId });
      }
      logger.error("ACKLINK_CREATE_FAILED", { error: err?.message || String(err) });
      throw err;
    }
  });

  app.get("/acklink/:linkId", async (request, reply) => {
    const reqId = request?.reqId;
    const logger = createLogger({ reqId });
    try {
      const linkId = String(request?.params?.linkId || "").trim();
      if (!parseHexBytes32(linkId)) {
        return reply.code(400).send({ ok: false, code: "INVALID_LINK_ID", reqId });
      }

      const { data, error } = await supabase
        .from("ack_links")
        .select("*")
        .eq("link_id", linkId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return reply.code(404).send({ ok: false, code: "NOT_FOUND", reqId });

      const now = Date.now();
      const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
      const isExpired = expiresAt > 0 && now >= expiresAt && String(data.status) === "CREATED";

      return reply.send({
        ok: true,
        reqId,
        linkId: data.link_id,
        status: isExpired ? "EXPIRED" : data.status,
        sender: data.sender,
        token: data.token,
        amountUsdc6: String(data.amount_usdc6),
        feeUsdc6: String(data.fee_usdc6),
        speed: data.speed,
        expiresAt: data.expires_at,
        meta: data.meta ?? null,
        claimedTo: data.claimed_to ?? null,
        txHashCreate: data.tx_hash_create ?? null,
        txHashClaim: data.tx_hash_claim ?? null,
        txHashRefund: data.tx_hash_refund ?? null,
      });
    } catch (err) {
      logger.error("ACKLINK_GET_FAILED", { error: err?.message || String(err) });
      throw err;
    }
  });

  app.post("/acklink/claim", async (request, reply) => {
    const reqId = request?.reqId;
    const logger = createLogger({ reqId });
    const ackTimeoutMs = getAckTimeoutMs();
    const ackEdgeTimeoutMs = getAckEdgeTimeoutMs();

    try {
      const result = await withTimeout(
        (async () => {
          const body = request.body ?? {};
          const linkId = String(body?.linkId || "").trim();
          const claimer = String(body?.claimer || "").trim();
          const note = body?.note ?? null;
          const noteSignature = body?.noteSignature ?? null;
          const noteSender = body?.noteSender ?? null;
          const userOpSignature = body?.userOpSignature ?? null;
          const userOpDraft = body?.userOpDraft ?? null;

          if (!parseHexBytes32(linkId)) {
            return reply.code(400).send({ ok: false, code: "INVALID_LINK_ID", reqId });
          }
          if (!claimer || !isAddress(claimer)) {
            return reply.code(400).send({ ok: false, code: "INVALID_CLAIMER", reqId });
          }

          const limited = enforceAckRateLimit(request, reply, claimer);
          if (limited) return limited;

          const { data, error } = await supabase
            .from("ack_links")
            .select("*")
            .eq("link_id", linkId)
            .maybeSingle();
          if (error) throw error;
          if (!data) return reply.code(404).send({ ok: false, code: "NOT_FOUND", reqId });

          if (String(data.status) !== "CREATED") {
            return reply.code(400).send({ ok: false, code: "INVALID_STATUS", reqId });
          }

          const expiresAtMs = data.expires_at ? new Date(data.expires_at).getTime() : 0;
          if (expiresAtMs && Date.now() >= expiresAtMs) {
            return reply.code(400).send({ ok: false, code: "EXPIRED", reqId });
          }

          const chainId = Number(process.env.CHAIN_ID ?? 84532);
          const { acklinkVault, factory, bundlerUrl } = getAckConfig();

          const resolvedRpcUrl = await resolveRpcUrl({
            rpcUrl: process.env.RPC_URL,
            bundlerUrl: process.env.BUNDLER_URL,
            chainId,
          });

          const smart = await resolveSmartAccount({
            rpcUrl: resolvedRpcUrl,
            factoryAddress: factory,
            factorySource: "env.FACTORY",
            ownerEoa: claimer,
          });

          const laneResult = await sendAcklinkSponsored({
            action: "CLAIM",
            chainId,
            rpcUrl: resolvedRpcUrl,
            bundlerUrl,
            ownerEoa: claimer,
            speed: 0,
            linkId,
            claimTo: claimer,
            userOpSignature,
            userOpDraft,
          });

          if (laneResult?.needsUserOpSignature === true) {
            return reply.send({ reqId, ...laneResult });
          }

          const txHash = laneResult?.txHash ?? null;
          const userOpHash = laneResult?.userOpHash ?? null;

          await supabase
            .from("ack_links")
            .update({
              status: "CLAIMED",
              claimed_to: String(claimer).toLowerCase(),
              tx_hash_claim: txHash,
              user_op_hash_claim: userOpHash,
              updated_at: new Date().toISOString(),
            })
            .eq("link_id", linkId);

          const receiptPayload = {
            chainId,
            userOpHash,
            txHash,
            from: claimer,
            sender: smart.sender,
            ownerEoa: claimer,
            token: data.token,
            mode: "SPONSORED",
            feeMode: "plusFee",
            totalEntered: String(data.amount_usdc6),
            feeAmount: "0",
            totalDebited: String(data.amount_usdc6),
            name: data.meta?.name ?? null,
            message: data.meta?.message ?? null,
            reason: data.meta?.reason ?? null,
            to: claimer,
            route: "acklink_claim",
            meta: {
              kind: "AckLink Claimed",
              route: "acklink_claim",
              linkId,
              speed: data.speed,
              feeUsdc6: String(data.fee_usdc6),
              amountUsdc6: String(data.amount_usdc6),
              acklinkVault,
              feeVault: String(process.env.FEEVAULT || "").trim(),
              name: data.meta?.name ?? null,
              message: data.meta?.message ?? null,
              reason: data.meta?.reason ?? null,
            },
          };

          const receiptResponse = await withTimeout(callQuickpayReceipt(receiptPayload, { reqId }), ackEdgeTimeoutMs, {
            code: "EDGE_TIMEOUT",
            status: 504,
            where: "acklink.receipt",
            message: "Receipt timeout",
          });
          const receiptId = receiptResponse?.receiptId ?? receiptResponse?.receipt_id ?? null;

          if (note && noteSignature && noteSender && receiptId) {
            await withTimeout(
              callQuickpayNote({
                receiptId,
                sender: noteSender,
                note,
                signature: noteSignature,
                chainId,
                reqId,
              }),
              ackEdgeTimeoutMs,
              {
                code: "EDGE_TIMEOUT",
                status: 504,
                where: "acklink.note",
                message: "Note timeout",
              }
            );
          }

          const ethSponsoredWei = txHash
            ? await recordSponsorshipCost({
                reqId,
                route: "acklink_claim",
                txHash,
                userOpHash,
                chainId,
                meta: { linkId },
              })
            : null;

          return reply.send({
            ok: true,
            reqId,
            txHash,
            userOpHash,
            receiptId,
            ...(ethSponsoredWei ? { ethSponsoredWei } : {}),
          });
        })(),
        ackTimeoutMs,
        { code: "TIMEOUT", status: 504, where: "acklink.claim", message: "ACKLINK_TIMEOUT" }
      );
      return result;
    } catch (err) {
      if (err?.code === "TIMEOUT") {
        return reply.code(504).send({ ok: false, code: "TIMEOUT", reqId });
      }
      logger.error("ACKLINK_CLAIM_FAILED", { error: err?.message || String(err) });
      throw err;
    }
  });

  app.post("/acklink/refund", async (request, reply) => {
    const reqId = request?.reqId;
    const logger = createLogger({ reqId });
    const ackTimeoutMs = getAckTimeoutMs();
    const ackEdgeTimeoutMs = getAckEdgeTimeoutMs();

    try {
      const result = await withTimeout(
        (async () => {
          const body = request.body ?? {};
          const linkId = String(body?.linkId || "").trim();
          const requester = String(body?.requester || "").trim();
          const userOpSignature = body?.userOpSignature ?? null;
          const userOpDraft = body?.userOpDraft ?? null;

          if (!parseHexBytes32(linkId)) {
            return reply.code(400).send({ ok: false, code: "INVALID_LINK_ID", reqId });
          }
          if (!requester || !isAddress(requester)) {
            return reply.code(400).send({ ok: false, code: "INVALID_REQUESTER", reqId });
          }

          const limited = enforceAckRateLimit(request, reply, requester);
          if (limited) return limited;

          const { data, error } = await supabase
            .from("ack_links")
            .select("*")
            .eq("link_id", linkId)
            .maybeSingle();
          if (error) throw error;
          if (!data) return reply.code(404).send({ ok: false, code: "NOT_FOUND", reqId });

          if (String(data.status) !== "CREATED") {
            return reply.code(400).send({ ok: false, code: "INVALID_STATUS", reqId });
          }

          const expiresAtMs = data.expires_at ? new Date(data.expires_at).getTime() : 0;
          if (!expiresAtMs || Date.now() < expiresAtMs) {
            return reply.code(400).send({ ok: false, code: "NOT_EXPIRED", reqId });
          }

          const chainId = Number(process.env.CHAIN_ID ?? 84532);
          const { acklinkVault, factory, bundlerUrl } = getAckConfig();

          const resolvedRpcUrl = await resolveRpcUrl({
            rpcUrl: process.env.RPC_URL,
            bundlerUrl: process.env.BUNDLER_URL,
            chainId,
          });

          const smart = await resolveSmartAccount({
            rpcUrl: resolvedRpcUrl,
            factoryAddress: factory,
            factorySource: "env.FACTORY",
            ownerEoa: requester,
          });

          const laneResult = await sendAcklinkSponsored({
            action: "REFUND",
            chainId,
            rpcUrl: resolvedRpcUrl,
            bundlerUrl,
            ownerEoa: requester,
            speed: 0,
            linkId,
            userOpSignature,
            userOpDraft,
          });

          if (laneResult?.needsUserOpSignature === true) {
            return reply.send({ reqId, ...laneResult });
          }

          const txHash = laneResult?.txHash ?? null;
          const userOpHash = laneResult?.userOpHash ?? null;

          await supabase
            .from("ack_links")
            .update({
              status: "REFUNDED",
              tx_hash_refund: txHash,
              user_op_hash_refund: userOpHash,
              updated_at: new Date().toISOString(),
            })
            .eq("link_id", linkId);

          const receiptPayload = {
            chainId,
            userOpHash,
            txHash,
            from: data.sender,
            sender: smart.sender,
            ownerEoa: data.sender,
            token: data.token,
            mode: "SPONSORED",
            feeMode: "plusFee",
            totalEntered: String(data.amount_usdc6),
            feeAmount: "0",
            totalDebited: String(data.amount_usdc6),
            name: data.meta?.name ?? null,
            message: data.meta?.message ?? null,
            reason: data.meta?.reason ?? null,
            to: data.sender,
            route: "acklink_refund",
            meta: {
              kind: "AckLink Refunded",
              route: "acklink_refund",
              linkId,
              speed: data.speed,
              feeUsdc6: String(data.fee_usdc6),
              amountUsdc6: String(data.amount_usdc6),
              acklinkVault,
              feeVault: String(process.env.FEEVAULT || "").trim(),
              name: data.meta?.name ?? null,
              message: data.meta?.message ?? null,
              reason: data.meta?.reason ?? null,
            },
          };

          const receiptResponse = await withTimeout(callQuickpayReceipt(receiptPayload, { reqId }), ackEdgeTimeoutMs, {
            code: "EDGE_TIMEOUT",
            status: 504,
            where: "acklink.receipt",
            message: "Receipt timeout",
          });
          const receiptId = receiptResponse?.receiptId ?? receiptResponse?.receipt_id ?? null;

          const ethSponsoredWei = txHash
            ? await recordSponsorshipCost({
                reqId,
                route: "acklink_refund",
                txHash,
                userOpHash,
                chainId,
                meta: { linkId },
              })
            : null;

          return reply.send({
            ok: true,
            reqId,
            txHash,
            userOpHash,
            receiptId,
            ...(ethSponsoredWei ? { ethSponsoredWei } : {}),
          });
        })(),
        ackTimeoutMs,
        { code: "TIMEOUT", status: 504, where: "acklink.refund", message: "ACKLINK_TIMEOUT" }
      );
      return result;
    } catch (err) {
      if (err?.code === "TIMEOUT") {
        return reply.code(504).send({ ok: false, code: "TIMEOUT", reqId });
      }
      logger.error("ACKLINK_REFUND_FAILED", { error: err?.message || String(err) });
      throw err;
    }
  });
}
