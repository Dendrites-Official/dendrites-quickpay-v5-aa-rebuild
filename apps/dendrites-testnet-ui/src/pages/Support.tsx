import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { logAppEvent } from "../lib/appEvents";
import { useAppMode } from "../demo/AppModeContext";
import { useWalletState } from "../demo/useWalletState";
import { isMobile } from "../utils/mobile";

const SUPPORT_EMAIL = "support@dendrites.ai";
const SUPPORT_DRAFT_KEY = "dx-support-draft-v1";

const TOPIC_OPTIONS = [
  "General support",
  "Transaction / receipt issue",
  "Wallet / connection",
  "Bulk Pay",
  "AckLink",
  "Security / reporting",
  "Partnerships",
] as const;

type TopicOption = (typeof TOPIC_OPTIONS)[number];

type SupportDraft = {
  fullName: string;
  company: string;
  email: string;
  topic: TopicOption;
  message: string;
};

function readDraft(): SupportDraft {
  if (typeof window === "undefined") {
    return {
      fullName: "",
      company: "",
      email: "",
      topic: "General support",
      message: "",
    };
  }
  try {
    const raw = localStorage.getItem(SUPPORT_DRAFT_KEY);
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw) as Partial<SupportDraft>;
    return {
      fullName: parsed.fullName ?? "",
      company: parsed.company ?? "",
      email: parsed.email ?? "",
      topic: TOPIC_OPTIONS.includes(parsed.topic as TopicOption)
        ? (parsed.topic as TopicOption)
        : "General support",
      message: parsed.message ?? "",
    };
  } catch {
    return {
      fullName: "",
      company: "",
      email: "",
      topic: "General support",
      message: "",
    };
  }
}

function getDeviceLabel() {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "Tablet";
  if (isMobile()) return "Phone";
  return "Laptop / desktop";
}

function getBrowserSummary() {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "Unknown platform";
  if (/Edg\//.test(ua)) return `Edge on ${platform}`;
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return `Chrome on ${platform}`;
  if (/Firefox\//.test(ua)) return `Firefox on ${platform}`;
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return `Safari on ${platform}`;
  return platform;
}

function buildSupportBody(params: {
  fullName: string;
  company: string;
  email: string;
  topic: string;
  message: string;
  wallet: string;
  chain: string;
  receiptId: string;
  txHash: string;
  userOpHash: string;
}) {
  const timezone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown" : "Unknown";

  return [
    "DENDRITES SUPPORT REQUEST",
    "========================",
    "",
    `Name: ${params.fullName || ""}`,
    `Company: ${params.company || ""}`,
    `Email: ${params.email || ""}`,
    `Topic: ${params.topic}`,
    "",
    "MESSAGE",
    params.message,
    "",
    "DIAGNOSTICS (optional but helpful)",
    `Network: ${params.chain || "Base / Base Sepolia / other"}`,
    `Tx hash / UserOp hash / Receipt ID: ${[params.txHash, params.userOpHash, params.receiptId].filter(Boolean).join(" | ")}`,
    `Wallet: ${params.wallet || "MetaMask / Coinbase / other"}`,
    `Browser + OS: ${getBrowserSummary()} • ${getDeviceLabel()}`,
    `Approx. time (with timezone): ${new Date().toLocaleString()} (${timezone})`,
    "",
    "Thank you,",
    "Dendrites Support",
  ].join("\n");
}

function buildMailtoUrl(subject: string, body: string) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function buildGmailUrl(subject: string, body: string) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: SUPPORT_EMAIL,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function buildOutlookUrl(subject: string, body: string) {
  const params = new URLSearchParams({
    to: SUPPORT_EMAIL,
    subject,
    body,
  });
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
}

export default function Support() {
  const [params] = useSearchParams();
  const { isDemo } = useAppMode();
  const { address, isConnected, chainId, chainName } = useWalletState();
  const initialDraft = useMemo(readDraft, []);
  const [fullName, setFullName] = useState(initialDraft.fullName);
  const [company, setCompany] = useState(initialDraft.company);
  const [email, setEmail] = useState(initialDraft.email);
  const [topic, setTopic] = useState<TopicOption>(initialDraft.topic);
  const [message, setMessage] = useState(initialDraft.message);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [composeReady, setComposeReady] = useState(false);

  const receiptId = String(params.get("rid") ?? params.get("receiptId") ?? "").trim();
  const txHash = String(params.get("tx") ?? "").trim();
  const userOpHash = String(params.get("uop") ?? "").trim();
  const hasTransactionContext = Boolean(receiptId || txHash || userOpHash);

  useEffect(() => {
    if (!hasTransactionContext) return;
    setTopic("Transaction / receipt issue");
    setMessage((prev) => {
      if (prev.trim()) return prev;
      const lines = [
        "Tell us what happened.",
        receiptId ? `Receipt ID: ${receiptId}` : "",
        txHash ? `Tx Hash: ${txHash}` : "",
        userOpHash ? `UserOp Hash: ${userOpHash}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    });
  }, [hasTransactionContext, receiptId, txHash, userOpHash]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextDraft: SupportDraft = { fullName, company, email, topic, message };
    try {
      localStorage.setItem(SUPPORT_DRAFT_KEY, JSON.stringify(nextDraft));
    } catch {
      // ignore storage failures
    }
  }, [company, email, fullName, message, topic]);

  const chainLabel = chainName || (chainId ? `Chain ${chainId}` : "Not connected");
  const connectedWalletLabel = isConnected && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Guest";
  const supportBody = useMemo(
    () =>
      buildSupportBody({
        fullName,
        company,
        email,
        topic,
        message,
        wallet: isConnected && address ? address : "",
        chain: chainLabel,
        receiptId,
        txHash,
        userOpHash,
      }),
    [address, chainLabel, company, email, fullName, isConnected, message, receiptId, topic, txHash, userOpHash]
  );

  const subject = useMemo(() => {
    const topicSuffix = topic || "General support";
    const context = receiptId || txHash || userOpHash || "";
    return `Dendrites Support — ${topicSuffix}${context ? ` (${context})` : ""}`;
  }, [receiptId, topic, txHash, userOpHash]);

  const mailtoUrl = useMemo(() => buildMailtoUrl(subject, supportBody), [subject, supportBody]);
  const gmailUrl = useMemo(() => buildGmailUrl(subject, supportBody), [subject, supportBody]);
  const outlookUrl = useMemo(() => buildOutlookUrl(subject, supportBody), [subject, supportBody]);

  const copySupportRequest = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${SUPPORT_EMAIL}\nSubject: ${subject}\n\n${supportBody}`);
      setStatus("Support message copied. Paste it into Gmail, Outlook, or any mail client.");
    } catch {
      setError(`Could not copy the support request. Email ${SUPPORT_EMAIL} directly.`);
    }
  };

  const openComposeUrl = (url: string, target: "same" | "new" = "new") => {
    if (target === "same") {
      window.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const sendSupport = async () => {
    setError("");
    setStatus("");

    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!email.trim()) {
      setError("Email address is required.");
      return;
    }
    if (!message.trim()) {
      setError("Message is required.");
      return;
    }

    void logAppEvent("support_compose", {
      address: address ?? null,
      chainId: chainId ?? null,
      meta: {
        topic,
        hasTransactionContext,
        device: getDeviceLabel(),
        isConnected,
      },
    });

    setComposeReady(true);
    setStatus("Choose how to send this support message.");
  };

  return (
    <main className="dx-container dx-supportPage">
      <section className="dx-supportIntro">
        <div className="dx-supportHero">
          <div className="dx-kicker">Dendrites</div>
          <h1 className="dx-supportTitle">
            Support that's fast,
            <br />
            precise, and human.
          </h1>
          <p className="dx-supportLead">
            Share context once. We&apos;ll respond with the exact next step, with receipts, hashes, or configuration
            notes when needed.
          </p>

          <div className="dx-supportDivider" />

          <div className="dx-supportQuoteCard">
            <div className="dx-supportQuoteBadge">DX</div>
            <div>
              <p className="dx-supportQuoteText">
                "We built the support flow the same way we built the UI: reduce ambiguity, keep the path visible, and
                ship clarity."
              </p>
              <div className="dx-supportQuoteMeta">Dendrites Ops</div>
              <div className="dx-supportQuoteSub">Payments UI / Testnet</div>
            </div>
          </div>

          <div className="dx-supportQuickLinks">
            <Link className="dx-supportChip" to="/faqs">FAQs</Link>
            <Link className="dx-supportChip" to="/wallet">Wallet Health</Link>
            <Link className="dx-supportChip" to="/receipts">Receipt Explorer</Link>
          </div>

          <p className="dx-supportFootnote">
            For urgent transaction issues, include a tx hash or receipt ID.
          </p>
        </div>

        <section className="dx-card dx-supportFormCard" aria-label="Support contact form">
          <div className="dx-card-in">
            <div className="dx-card-head dx-supportFormHead">
              <div>
                <h2 className="dx-card-title">Contact</h2>
              </div>
              <p className="dx-card-hint">We usually reply within 24 hours.</p>
            </div>

            <div className="dx-supportIdentity">
              <div className="dx-supportIdentityPill">{isConnected ? "Wallet connected" : "No login required"}</div>
              <div className="dx-supportIdentityMeta">
                <span>{connectedWalletLabel}</span>
                <span>{chainLabel}</span>
                {isDemo ? <span>Demo mode</span> : null}
              </div>
            </div>

            <div className="dx-form">
              <div className="dx-supportRow2">
                <label className="dx-field">
                  <span className="dx-label">Full Name</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
                </label>

                <label className="dx-field">
                  <span className="dx-label">Company</span>
                  <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" />
                </label>
              </div>

              <label className="dx-field">
                <span className="dx-label">Email Address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                />
              </label>

              <label className="dx-field">
                <span className="dx-label">Topic</span>
                <select value={topic} onChange={(e) => setTopic(e.target.value as TopicOption)}>
                  {TOPIC_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <label className="dx-field">
                <span className="dx-label">Message</span>
                <textarea
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what happened. Include chain + tx hash / receipt id if relevant."
                />
              </label>

              {hasTransactionContext ? (
                <div className="dx-supportContext">
                  <span className="dx-supportContextLabel">Attached context</span>
                  {receiptId ? <span className="dx-supportContextItem">Receipt {receiptId}</span> : null}
                  {txHash ? <span className="dx-supportContextItem">Tx {`${txHash.slice(0, 10)}...`}</span> : null}
                  {userOpHash ? <span className="dx-supportContextItem">UserOp {`${userOpHash.slice(0, 10)}...`}</span> : null}
                </div>
              ) : null}

              {error ? <div className="dx-alert dx-alert-danger">{error}</div> : null}
              {status ? <div className="dx-alert">{status}</div> : null}

              <div className="dx-supportSubmitRow">
                <button type="button" className="dx-supportSubmit" onClick={sendSupport}>
                  Send message
                </button>
                <span className="dx-supportSubmitArrow" aria-hidden="true">→</span>
              </div>

              {composeReady ? (
                <div className="dx-supportDeliveryCard">
                  <div className="dx-supportDeliveryTitle">Delivery options</div>
                  <div className="dx-supportDeliveryGrid">
                    <button type="button" className="dx-supportDeliveryBtn" onClick={() => openComposeUrl(gmailUrl)}>
                      Open Gmail
                    </button>
                    <button type="button" className="dx-supportDeliveryBtn" onClick={() => openComposeUrl(outlookUrl)}>
                      Open Outlook
                    </button>
                    <button type="button" className="dx-supportDeliveryBtn" onClick={() => openComposeUrl(mailtoUrl, "same")}>
                      Open Mail App
                    </button>
                    <button type="button" className="dx-supportDeliveryBtn" onClick={copySupportRequest}>
                      Copy message
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="dx-supportMetaLine">Or email {SUPPORT_EMAIL}</div>
              <div className="dx-supportMetaHint">
                Tip: if your issue is pending / stuck, include the nonce and chain.
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
