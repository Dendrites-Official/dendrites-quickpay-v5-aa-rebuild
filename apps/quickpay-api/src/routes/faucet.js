import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { ethers } from "ethers";

const CHAIN_ID = 84532;
const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const MDNDX_DRIP_HUMAN = "20";
const MDNDX_COOLDOWN_SEC = 86400;
const CHALLENGE_TTL_MINUTES = 10;

const WAITLIST_TABLE = "waitlist_user";
const WAITLIST_EMAIL_COL = "email";
const WAITLIST_WALLET_COL = "wallet_evm";
const WAITLIST_REFERRAL_COL = "referral_code";
const WAITLIST_REFERRAL_ALT_COL = "referred_by_code";

const quickpayDb = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const waitlistDb = createClient(
  process.env.WAITLIST_SUPABASE_URL || "",
  process.env.WAITLIST_SUPABASE_SERVICE_ROLE_KEY || ""
);

let waitlistHasWalletColumn = null;
let waitlistHasReferralColumn = null;
let waitlistHasReferralAltColumn = null;
let faucetClaimsHasWalletColumn = null;
let faucetClaimsHasAmountColumn = null;

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getClientIp(request) {
  const forwarded = String(request?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded;
  return String(request?.ip || "");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getSaltOrThrow() {
  const salt = String(process.env.IP_HASH_SALT || "");
  if (!salt) {
    throw new Error("Missing IP_HASH_SALT");
  }
  return salt;
}

function getMdndxConfig() {
  const token = String(
    process.env.FAUCET_MDNDX_TOKEN ||
      process.env.MDNDX ||
      process.env.MDNDX_TOKEN ||
      ""
  ).trim();
  const decimalsRaw = String(process.env.FAUCET_MDNDX_DECIMALS || "").trim();
  const decimals = Number(decimalsRaw || "18");
  const dripUnitsRaw = String(process.env.FAUCET_MDNDX_DRIP_UNITS || "").trim();
  return {
    token: token || null,
    decimals: Number.isFinite(decimals) ? decimals : 18,
    dripUnitsRaw: dripUnitsRaw || null,
  };
}

async function verifyTurnstile(token) {
  const disabled = String(process.env.TURNSTILE_DISABLED || "").toLowerCase() === "true";
  if (disabled) return true;
  if (!token) {
    const err = new Error("missing_turnstile_token");
    err.status = 400;
    throw err;
  }
  const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    throw new Error("Missing TURNSTILE_SECRET_KEY");
  }
  const body = new URLSearchParams();
  body.append("secret", secret);
  body.append("response", token);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const data = await res.json();
  if (!data?.success) {
    const err = new Error("turnstile_failed");
    err.status = 400;
    throw err;
  }
  return true;
}

function sendValidation(reply, message) {
  return reply.code(400).send({ ok: false, error: message });
}

function sendServerError(reply, err) {
  const debug = String(process.env.QUICKPAY_DEBUG || "").trim() === "1";
  const isProd = process.env.NODE_ENV === "production";
  if (debug) {
    console.error("Faucet error:", err);
  }
  return reply.code(500).send({
    ok: false,
    error: "SERVER_ERROR",
    details: !isProd || debug ? String(err?.message || err) : undefined,
  });
}

async function resolveWaitlistWalletColumn() {
  if (waitlistHasWalletColumn !== null) return waitlistHasWalletColumn;
  try {
    const { error } = await waitlistDb
      .from(WAITLIST_TABLE)
      .select(WAITLIST_WALLET_COL)
      .limit(1);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("wallet_evm") && msg.includes("column")) {
        waitlistHasWalletColumn = false;
        return waitlistHasWalletColumn;
      }
      throw error;
    }
    waitlistHasWalletColumn = true;
    return waitlistHasWalletColumn;
  } catch {
    waitlistHasWalletColumn = false;
    return waitlistHasWalletColumn;
  }
}

async function resolveWaitlistReferralColumn() {
  if (waitlistHasReferralColumn !== null) return waitlistHasReferralColumn;
  try {
    const { error } = await waitlistDb
      .from(WAITLIST_TABLE)
      .select(WAITLIST_REFERRAL_COL)
      .limit(1);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("referral_code") && msg.includes("column")) {
        waitlistHasReferralColumn = false;
        return waitlistHasReferralColumn;
      }
      throw error;
    }
    waitlistHasReferralColumn = true;
    return waitlistHasReferralColumn;
  } catch {
    waitlistHasReferralColumn = false;
    return waitlistHasReferralColumn;
  }
}

async function resolveWaitlistReferralAltColumn() {
  if (waitlistHasReferralAltColumn !== null) return waitlistHasReferralAltColumn;
  try {
    const { error } = await waitlistDb
      .from(WAITLIST_TABLE)
      .select(WAITLIST_REFERRAL_ALT_COL)
      .limit(1);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("referred_by_code") && msg.includes("column")) {
        waitlistHasReferralAltColumn = false;
        return waitlistHasReferralAltColumn;
      }
      throw error;
    }
    waitlistHasReferralAltColumn = true;
    return waitlistHasReferralAltColumn;
  } catch {
    waitlistHasReferralAltColumn = false;
    return waitlistHasReferralAltColumn;
  }
}

async function resolveFaucetClaimsWalletColumn() {
  if (faucetClaimsHasWalletColumn !== null) return faucetClaimsHasWalletColumn;
  try {
    const { error } = await quickpayDb
      .from("faucet_claims")
      .select("wallet_address")
      .limit(1);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("wallet_address") && msg.includes("column")) {
        faucetClaimsHasWalletColumn = false;
        return faucetClaimsHasWalletColumn;
      }
      throw error;
    }
    faucetClaimsHasWalletColumn = true;
    return faucetClaimsHasWalletColumn;
  } catch {
    faucetClaimsHasWalletColumn = false;
    return faucetClaimsHasWalletColumn;
  }
}

async function resolveFaucetClaimsAmountColumn() {
  if (faucetClaimsHasAmountColumn !== null) return faucetClaimsHasAmountColumn;
  try {
    const { error } = await quickpayDb
      .from("faucet_claims")
      .select("amount")
      .limit(1);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("amount") && msg.includes("column")) {
        faucetClaimsHasAmountColumn = false;
        return faucetClaimsHasAmountColumn;
      }
      throw error;
    }
    faucetClaimsHasAmountColumn = true;
    return faucetClaimsHasAmountColumn;
  } catch {
    faucetClaimsHasAmountColumn = false;
    return faucetClaimsHasAmountColumn;
  }
}

export function registerFaucetRoutes(app) {
  app.get("/faucet/config", async (_, reply) => {
    const mdndx = getMdndxConfig();
    return reply.send({
      ok: true,
      chainId: CHAIN_ID,
      circleFaucetUrl: CIRCLE_FAUCET_URL,
      usdc: {
        address: USDC_BASE_SEPOLIA,
        decimals: 6,
        symbol: "USDC",
      },
      mdndx: {
        address: mdndx.token,
        decimals: mdndx.decimals,
        symbol: "mDNDX",
        dripAmount: MDNDX_DRIP_HUMAN,
        cooldownSec: MDNDX_COOLDOWN_SEC,
      },
      mdndxConfigured: Boolean(mdndx.token),
    });
  });

  app.post("/faucet/mdndx/verify", async (request, reply) => {
    try {
      const { email, address } = request.body ?? {};
      if (!email) return sendValidation(reply, "email_required");
      if (!isAddress(address)) return sendValidation(reply, "invalid_address");

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return sendValidation(reply, "email_required");

      const hasWallet = await resolveWaitlistWalletColumn();
      const selectCols = hasWallet
        ? `id, ${WAITLIST_EMAIL_COL}, ${WAITLIST_WALLET_COL}`
        : `id, ${WAITLIST_EMAIL_COL}`;

      const { data, error } = await waitlistDb
        .from(WAITLIST_TABLE)
        .select(selectCols)
        .eq(WAITLIST_EMAIL_COL, normalizedEmail)
        .limit(1);

      if (error) {
        return sendServerError(reply, error);
      }

      const verified = Array.isArray(data) && data.length > 0;
      return reply.send({ ok: true, verified });
    } catch (err) {
      return sendServerError(reply, err);
    }
  });

  app.post("/faucet/mdndx/join", async (request, reply) => {
    try {
      const { email, password, address, referral } = request.body ?? {};
      if (!email || !password || !isAddress(address)) {
        return sendValidation(reply, "INVALID_INPUT");
      }

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return sendValidation(reply, "INVALID_INPUT");

      const hasWallet = await resolveWaitlistWalletColumn();
      const hasReferral = await resolveWaitlistReferralColumn();
      const hasReferralAlt = await resolveWaitlistReferralAltColumn();

      let already = false;
      const authResult = await waitlistDb.auth.admin.createUser({
        email: normalizedEmail,
        password: String(password),
        email_confirm: true,
      });

      if (authResult?.error) {
        const msg = String(authResult.error.message || "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("duplicate")) {
          already = true;
        } else if (msg.includes("confirm") || msg.includes("verify")) {
          return reply.code(403).send({ ok: false, error: "EMAIL_NOT_VERIFIED" });
        } else if (msg.includes("blocked")) {
          return reply.code(403).send({ ok: false, error: "JOIN_BLOCKED" });
        } else {
          return sendServerError(reply, authResult.error);
        }
      }

      if (authResult?.data?.user && !authResult.data.user.email_confirmed_at) {
        return reply.code(403).send({ ok: false, error: "EMAIL_NOT_VERIFIED" });
      }

      const selectCols = ["id", WAITLIST_EMAIL_COL];
      if (hasWallet) selectCols.push(WAITLIST_WALLET_COL);
      if (hasReferral) selectCols.push(WAITLIST_REFERRAL_COL);
      if (hasReferralAlt) selectCols.push(WAITLIST_REFERRAL_ALT_COL);

      const { data: existing, error: existingError } = await waitlistDb
        .from(WAITLIST_TABLE)
        .select(selectCols.join(","))
        .eq(WAITLIST_EMAIL_COL, normalizedEmail)
        .maybeSingle();

      if (existingError) return sendServerError(reply, existingError);

      const updatePayload = {};
      const insertPayload = { [WAITLIST_EMAIL_COL]: normalizedEmail };

      if (hasWallet) {
        const walletValue = String(existing?.[WAITLIST_WALLET_COL] || "").trim();
        if (!walletValue) {
          updatePayload[WAITLIST_WALLET_COL] = String(address).trim();
          insertPayload[WAITLIST_WALLET_COL] = String(address).trim();
        }
      }
      if (referral) {
        const referralTrimmed = String(referral).trim();
        if (hasReferral && referralTrimmed) {
          const referralValue = String(existing?.[WAITLIST_REFERRAL_COL] || "").trim();
          if (!referralValue) {
            updatePayload[WAITLIST_REFERRAL_COL] = referralTrimmed;
            insertPayload[WAITLIST_REFERRAL_COL] = referralTrimmed;
          }
        } else if (hasReferralAlt && referralTrimmed) {
          const referralValue = String(existing?.[WAITLIST_REFERRAL_ALT_COL] || "").trim();
          if (!referralValue) {
            updatePayload[WAITLIST_REFERRAL_ALT_COL] = referralTrimmed;
            insertPayload[WAITLIST_REFERRAL_ALT_COL] = referralTrimmed;
          }
        }
      }

      if (existing?.id) {
        if (Object.keys(updatePayload).length > 0) {
          const { error: updateError } = await waitlistDb
            .from(WAITLIST_TABLE)
            .update(updatePayload)
            .eq("id", existing.id);
          if (updateError) return sendServerError(reply, updateError);
        }
      } else {
        const { error: insertError } = await waitlistDb.from(WAITLIST_TABLE).insert(insertPayload);
        if (insertError) return sendServerError(reply, insertError);
      }

      return reply.send({ ok: true, joined: true, already });
    } catch (err) {
      return sendServerError(reply, err);
    }
  });

  app.post("/faucet/mdndx/challenge", async (request, reply) => {
    try {
      const { email, address } = request.body ?? {};
      if (!email) return sendValidation(reply, "email_required");
      if (!isAddress(address)) return sendValidation(reply, "invalid_address");

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return sendValidation(reply, "email_required");

      const salt = getSaltOrThrow();
      const clientIp = getClientIp(request);
      const ipHash = sha256Hex(`${salt}${clientIp}`);

      const nonce = `0x${randomBytes(32).toString("hex")}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MINUTES * 60 * 1000);
      const messageToSign = `Dendrites Faucet (Base Sepolia)\nClaim: ${MDNDX_DRIP_HUMAN} mDNDX\nWallet: ${address}\nEmail: ${normalizedEmail}\nChallenge: ${nonce}\nExpires: ${expiresAt.toISOString()}`;

      const { data, error } = await quickpayDb
        .from("faucet_challenges")
        .insert({
          expires_at: expiresAt.toISOString(),
          used_at: null,
          address: String(address).toLowerCase(),
          email: normalizedEmail,
          message: messageToSign,
          ip_hash: ipHash,
        })
        .select("id")
        .single();

      if (error) return sendServerError(reply, error);

      return reply.send({
        ok: true,
        challengeId: data?.id,
        messageToSign,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      if (err?.status === 400) return sendValidation(reply, err.message);
      return sendServerError(reply, err);
    }
  });

  app.post("/faucet/mdndx/claim", async (request, reply) => {
    try {
      const { email, address, challengeId, signature, turnstileToken } = request.body ?? {};
      if (!email) return sendValidation(reply, "email_required");
      if (!isAddress(address)) return sendValidation(reply, "invalid_address");
      if (!challengeId) return sendValidation(reply, "challenge_required");
      if (!signature) return sendValidation(reply, "signature_required");

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return sendValidation(reply, "email_required");

      await verifyTurnstile(turnstileToken);

      const salt = getSaltOrThrow();
      const clientIp = getClientIp(request);
      const ipHash = sha256Hex(`${salt}${clientIp}`);
      const uaHash = sha256Hex(`${salt}${String(request?.headers?.["user-agent"] || "")}`);

      const { data: challenge, error: challengeError } = await quickpayDb
        .from("faucet_challenges")
        .select("id, expires_at, used_at, address, email, message, ip_hash")
        .eq("id", challengeId)
        .maybeSingle();

      if (challengeError) return sendServerError(reply, challengeError);
      if (!challenge) return reply.code(400).send({ ok: false, error: "challenge_not_found" });

      if (challenge.used_at) {
        return reply.code(400).send({ ok: false, error: "challenge_used" });
      }

      const expiresAt = new Date(challenge.expires_at);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({ ok: false, error: "challenge_expired" });
      }

      if (String(challenge.address || "").toLowerCase() !== String(address).toLowerCase()) {
        return reply.code(400).send({ ok: false, error: "challenge_address_mismatch" });
      }
      if (String(challenge.email || "") !== normalizedEmail) {
        return reply.code(400).send({ ok: false, error: "challenge_email_mismatch" });
      }

      const recovered = ethers.verifyMessage(challenge.message, signature);
      if (String(recovered).toLowerCase() !== String(address).toLowerCase()) {
        return reply.code(400).send({ ok: false, error: "invalid_signature" });
      }

      const { data: waitlisted, error: waitlistError } = await waitlistDb
        .from(WAITLIST_TABLE)
        .select(`id, ${WAITLIST_EMAIL_COL}`)
        .eq(WAITLIST_EMAIL_COL, normalizedEmail)
        .limit(1);

      if (waitlistError) return sendServerError(reply, waitlistError);
      if (!Array.isArray(waitlisted) || waitlisted.length === 0) {
        return reply.code(403).send({ ok: false, error: "NOT_WAITLISTED" });
      }

      const normalizedAddress = String(address).toLowerCase();

      const { count: totalCount, error: totalError } = await quickpayDb
        .from("faucet_claims")
        .select("id", { count: "exact", head: true })
        .eq("kind", "mdndx")
        .eq("address", normalizedAddress);

      if (totalError) return sendServerError(reply, totalError);
      if (Number(totalCount || 0) >= 3) {
        return reply.code(429).send({ ok: false, error: "HARD_CAP" });
      }

      const cutoff = new Date(Date.now() - MDNDX_COOLDOWN_SEC * 1000);
      const { data: recent, error: recentError } = await quickpayDb
        .from("faucet_claims")
        .select("created_at")
        .eq("kind", "mdndx")
        .eq("address", normalizedAddress)
        .gte("created_at", cutoff.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentError) return sendServerError(reply, recentError);
      if (Array.isArray(recent) && recent.length > 0) {
        const lastAt = new Date(recent[0].created_at);
        const nextEligibleAt = new Date(lastAt.getTime() + MDNDX_COOLDOWN_SEC * 1000);
        return reply.code(429).send({
          ok: false,
          error: "COOLDOWN",
          nextEligibleAt: nextEligibleAt.toISOString(),
        });
      }

      const mdndx = getMdndxConfig();
      if (!mdndx.token) {
        return reply.code(503).send({ ok: false, error: "INSUFFICIENT_FAUCET_INVENTORY" });
      }

      const provider = new ethers.JsonRpcProvider(String(process.env.RPC_URL || "").trim());
      const faucetPk = String(process.env.FAUCET_PRIVATE_KEY || "").trim();
      if (!faucetPk) {
        return sendServerError(reply, new Error("Missing FAUCET_PRIVATE_KEY"));
      }
      const wallet = new ethers.Wallet(faucetPk, provider);

      const minEthWei = ethers.parseEther("0.00005");
      const ethBal = await provider.getBalance(wallet.address);
      if (ethBal <= minEthWei) {
        return reply.code(503).send({ ok: false, error: "INSUFFICIENT_FAUCET_INVENTORY" });
      }

      const erc20 = new ethers.Contract(
        mdndx.token,
        [
          "function balanceOf(address) view returns (uint256)",
          "function transfer(address,uint256) returns (bool)",
          "function decimals() view returns (uint8)",
          "function symbol() view returns (string)",
        ],
        wallet
      );

      const decimals = mdndx.decimals;
      const dripUnits = mdndx.dripUnitsRaw
        ? BigInt(mdndx.dripUnitsRaw)
        : BigInt(MDNDX_DRIP_HUMAN) * 10n ** BigInt(decimals);

      const tokenBal = await erc20.balanceOf(wallet.address);
      if (BigInt(tokenBal) < dripUnits) {
        return reply.code(503).send({ ok: false, error: "INSUFFICIENT_FAUCET_INVENTORY" });
      }

      const tx = await erc20.transfer(address, dripUnits);

      const hasWalletAddress = await resolveFaucetClaimsWalletColumn();
      const hasAmountColumn = await resolveFaucetClaimsAmountColumn();
      const claimPayload = {
        chain_id: CHAIN_ID,
        kind: "mdndx",
        address: normalizedAddress,
        email: normalizedEmail,
        token_address: mdndx.token,
        token_amount: dripUnits.toString(),
        tx_hash: tx.hash,
        status: "submitted",
        ip_hash: ipHash,
        ua_hash: uaHash,
        meta: {
          challengeId,
          dripHuman: MDNDX_DRIP_HUMAN,
        },
      };
      if (hasWalletAddress) {
        claimPayload.wallet_address = normalizedAddress;
      }
      if (hasAmountColumn) {
        claimPayload.amount = dripUnits.toString();
      }

      const { error: claimError } = await quickpayDb.from("faucet_claims").insert(claimPayload);

      if (claimError) return sendServerError(reply, claimError);

      await quickpayDb
        .from("faucet_challenges")
        .update({ used_at: new Date().toISOString() })
        .eq("id", challengeId);

      const nextEligibleAt = new Date(Date.now() + MDNDX_COOLDOWN_SEC * 1000);
      return reply.send({ ok: true, txHash: tx.hash, nextEligibleAt: nextEligibleAt.toISOString() });
    } catch (err) {
      if (err?.status === 400) return sendValidation(reply, err.message);
      return sendServerError(reply, err);
    }
  });

  return { quickpayDb, waitlistDb };
}
