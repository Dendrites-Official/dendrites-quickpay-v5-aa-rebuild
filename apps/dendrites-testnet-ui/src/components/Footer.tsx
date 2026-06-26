// src/components/Footer.tsx
import React, { useState } from "react";
import { Link } from "react-router-dom";

/* -------------------------------------------------
   Modal types
-------------------------------------------------- */
type PolicyType = "privacy" | "terms" | "security";

interface PolicyModalProps {
  type: PolicyType;
  onClose: () => void;
}

/* -------------------------------------------------
   Premium bottom-sheet / dialog modal
-------------------------------------------------- */
function PolicyModal({ type, onClose }: PolicyModalProps) {
  const title =
    type === "privacy"
      ? "Privacy Policy"
      : type === "terms"
      ? "Terms of Service"
      : "Security";

  const subtitle =
    type === "privacy"
      ? "How we handle your data across Dendrites AI and DNDX."
      : type === "terms"
      ? "The rules of using Dendrites AI and DNDX products."
      : "How we protect your data and payments infrastructure.";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9990,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      padding: "0 8px",
    }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      />

      {/* Card – bottom sheet */}
      <div style={{
        position: "relative", width: "100%", maxWidth: 576,
        borderRadius: "24px 24px 0 0",
        border: "1px solid rgba(255,255,255,0.10)",
        background: "linear-gradient(to bottom, rgba(2,6,23,0.97), rgba(0,0,0,0.97), rgba(2,6,23,0.97))",
        boxShadow: "0 12px 45px rgba(15,23,42,0.85)",
        overflow: "hidden",
        marginBottom: 8,
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
        }}>
          <div>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(255,255,255,0.40)", margin: 0 }}>
              LEGAL &amp; TRUST
            </p>
            <h2 style={{ marginTop: 2, fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff", margin: "2px 0 0" }}>
              {title}
            </h2>
            <p style={{ marginTop: 2, fontSize: 11, color: "rgba(255,255,255,0.55)", margin: "2px 0 0" }}>
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.40)",
              color: "rgba(255,255,255,0.80)",
              cursor: "pointer", fontSize: 18, lineHeight: 1,
              transition: "background 0.2s, color 0.2s, border-color 0.2s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "#fff";
              (e.currentTarget as HTMLButtonElement).style.color = "#000";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#fff";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.40)";
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.80)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.25)";
            }}
          >
            ×
          </button>
        </div>

        {/* Accent line */}
        <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.35), transparent)" }} />

        {/* Body */}
        <div style={{
          padding: "12px 20px 16px",
          maxHeight: "55vh", overflowY: "auto",
          fontSize: 14, lineHeight: 1.65, color: "rgba(255,255,255,0.70)",
        }} className="policy-scroll">
          {type === "privacy" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ margin: 0 }}>
                At Dendrites AI, we treat privacy as a product requirement – not
                an afterthought. We collect only what we need to operate,
                secure, and improve DNDX and never sell your data.
              </p>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "8px 0 0" }}>What we may collect</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Basic account details (email, name or handle).</li>
                <li>Usage and telemetry data about how DNDX is used.</li>
                <li>Technical metadata like IP address, device and browser.</li>
              </ul>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "12px 0 0" }}>What we use it for</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Operating the core product and keeping payments safe.</li>
                <li>Detecting abuse, fraud and security incidents.</li>
                <li>Improving performance, UX and documentation.</li>
              </ul>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "12px 0 0" }}>How we protect it</h3>
              <p style={{ margin: 0 }}>
                Data is stored with reputable cloud providers, access is
                strictly limited to operational needs, and we log access to
                sensitive systems. We aim to keep retention minimal and aligned
                with legal, accounting and security requirements.
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "10px 0 0" }}>
                This overview is informational and may evolve as the product
                grows. For specific agreements or enterprise needs, reach out to{" "}
                <a href="mailto:support@dendrites.ai" style={{ textDecoration: "underline", color: "inherit" }}>
                  support@dendrites.ai
                </a>.
              </p>
            </div>
          )}

          {type === "terms" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ margin: 0 }}>
                By using Dendrites AI and DNDX, you agree to act in good faith
                and comply with applicable law. We provide the infrastructure
                for commerce-grade payments; how you use it must remain
                legitimate and compliant.
              </p>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "8px 0 0" }}>Your responsibilities</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Use DNDX only for lawful and permitted activities.</li>
                <li>Protect your keys, credentials and access tokens.</li>
                <li>Do not attempt to attack, reverse-engineer or abuse the platform.</li>
              </ul>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "12px 0 0" }}>Our responsibilities</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Operate the service with a focus on reliability and safety.</li>
                <li>Communicate material changes to core features or policies.</li>
                <li>Reserve the right to suspend access in case of abuse, security risk or non-compliance.</li>
              </ul>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "12px 0 0" }}>No guarantees, limited liability</h3>
              <p style={{ margin: 0 }}>
                DNDX is provided on an &quot;as-is&quot; and &quot;as-available&quot; basis. To the
                fullest extent permitted by law, we disclaim warranties and
                limit liability for indirect or consequential damages. If you
                are building mission-critical volume, please talk to us about a
                dedicated SLA.
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "10px 0 0" }}>
                This is a simplified summary to fit the UI. For formal
                enterprise contracts, custom SLAs or jurisdiction-specific
                terms, contact{" "}
                <a href="mailto:support@dendrites.ai" style={{ textDecoration: "underline", color: "inherit" }}>
                  support@dendrites.ai
                </a>.
              </p>
            </div>
          )}

          {type === "security" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ margin: 0 }}>
                Security is core to DNDX. We design the system assuming
                adversarial environments, hostile networks and real money at
                stake.
              </p>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "8px 0 0" }}>Platform security</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Encryption in transit using modern TLS everywhere.</li>
                <li>Least-privilege access controls for internal tools and infrastructure.</li>
                <li>Segregated environments with strict change management and review.</li>
              </ul>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "12px 0 0" }}>Payment &amp; data protection</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Audit-friendly logging of critical payment flows.</li>
                <li>Monitoring for anomalous or abuse-like activity.</li>
                <li>Support for safe reversibility / undo flows without exposing raw keys.</li>
              </ul>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 13, margin: "12px 0 0" }}>Working with us</h3>
              <p style={{ margin: 0 }}>
                If you&apos;re a security researcher or enterprise team: we want
                to hear from you. Share findings, questions or requirements at{" "}
                <a href="mailto:support@dendrites.ai" style={{ textDecoration: "underline", color: "inherit" }}>
                  support@dendrites.ai
                </a>.
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "10px 0 0" }}>
                Do not test or probe production systems in ways that impact
                customers without prior written permission. We can provide
                dedicated sandboxes for structured testing.
              </p>
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(255,255,255,0.10)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 11, color: "rgba(255,255,255,0.45)",
        }}>
          <span>Last updated · 2025</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.70)", fontSize: 11,
              textDecoration: "underline", textUnderlineOffset: 4,
              padding: 0,
            }}
          >
            Close
          </button>
        </div>
      </div>

      <style>{`
        .policy-scroll::-webkit-scrollbar { width: 6px; }
        .policy-scroll::-webkit-scrollbar-track { background: transparent; }
        .policy-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.7); border-radius: 9999px; }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------
   Footer
-------------------------------------------------- */
export default function Footer({ showCompanyInfo = false }: { showCompanyInfo?: boolean }) {
  const [openModal, setOpenModal] = useState<PolicyType | null>(null);

  return (
    <>
      <footer style={{
        width: "100%", maxWidth: 1280,
        margin: "0 auto",
        padding: "24px 16px",
      }}>

        {/* ── MOBILE COMPACT FOOTER ── */}
        <div className="qp-footer-mobile">
          {/* Logo + tagline */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <img
              src="/videos/logo33.gif"
              alt="Dendrites AI"
              style={{
                height: 48, width: 48, objectFit: "contain", borderRadius: 8,
                filter: "brightness(1.2) contrast(1.1)",
                backgroundColor: "rgba(0,0,0,0.3)",
              }}
            />
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", textAlign: "center", maxWidth: 280, lineHeight: 1.6, margin: 0 }}>
              Commerce-grade payments with Web3 simplicity. Cancel payments,
              know exact costs, no token drama.
            </p>
          </div>

          {/* Contact */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 12 }}>
            <a href="mailto:support@dendrites.ai" className="qp-footer-link" style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.70)", textDecoration: "none" }}>
              <EnvelopeIcon />
              <span>support@dendrites.ai</span>
            </a>
            <a href="mailto:hello@dendrites.ai" className="qp-footer-link" style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.70)", textDecoration: "none" }}>
              <EnvelopeIcon />
              <span>hello@dendrites.ai</span>
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.60)" }}>
              <LocationIcon />
              <span>New York, NY</span>
            </div>
          </div>

          {/* Social icons row */}
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 16 }}>
            <SocialLink href="https://x.com/Dendrites_AI/status/1979407183478743352" label="X / Twitter"><XIcon /></SocialLink>
            <SocialLink href="https://linkedin.com/company/dendrites-ai" label="LinkedIn"><LinkedInIcon /></SocialLink>
            <SocialLink href="https://t.me/Dendrites_Chat" label="Telegram"><TelegramIcon /></SocialLink>
            <SocialLink href="https://discord.gg/2vPu6PerTU" label="Discord"><DiscordIcon /></SocialLink>
            <SocialLink href="https://github.com/Dendrites-Official" label="GitHub"><GitHubIcon /></SocialLink>
          </div>

          {/* Quick links */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 16px", marginBottom: 16, fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            <a href="/docs" className="qp-footer-link" style={{ color: "inherit", textDecoration: "none" }}>Whitepaper</a>
            <a href="/#escrow-quickpay" className="qp-footer-link" style={{ color: "inherit", textDecoration: "none" }}>Experience Undo</a>
            <a href="/roadmap" className="qp-footer-link" style={{ color: "inherit", textDecoration: "none" }}>Roadmap</a>
            <Link to="/careers" className="qp-footer-link" style={{ color: "inherit", textDecoration: "none" }}>Careers</Link>
            <Link to="/about" className="qp-footer-link" style={{ color: "inherit", textDecoration: "none" }}>About Us</Link>
            <a href="https://shorturl.at/vpN6j" target="_blank" rel="noopener noreferrer" className="qp-footer-link" style={{ color: "inherit", textDecoration: "none" }}>Press</a>
          </div>

          {/* Bottom bar (mobile) */}
          <div style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.10)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", textAlign: "center", lineHeight: 1.7 }}>
              © 2025 Dendrites AI<br />
              Built for commerce-grade safety
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
              <button type="button" onClick={() => setOpenModal("privacy")} className="qp-footer-link qp-footer-btn">Privacy</button>
              <button type="button" onClick={() => setOpenModal("terms")} className="qp-footer-link qp-footer-btn">Terms</button>
              <button type="button" onClick={() => setOpenModal("security")} className="qp-footer-link qp-footer-btn">Security</button>
            </div>
          </div>
        </div>

        {/* ── DESKTOP/TABLET FULL FOOTER ── */}
        <div className="qp-footer-desktop">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "32px 32px", marginBottom: 48 }}>

            {/* Column 1: Logo & Tagline */}
            <div style={{ gridColumn: "span 1" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: 0 }}>
                <img
                  src="/videos/logo33.gif"
                  alt="Dendrites AI"
                  style={{
                    height: 220, width: 220, objectFit: "contain", borderRadius: 12,
                    filter: "brightness(1.2) contrast(1.1)",
                    backgroundColor: "rgba(0,0,0,0.3)",
                    padding: 0,
                  }}
                />
              </div>
              <p style={{ color: "rgba(255,255,255,0.70)", fontSize: 14, lineHeight: 1.6, marginBottom: 0, maxWidth: 280, marginTop: 12 }}>
                Commerce-grade payments with Web3 simplicity. Cancel payments,
                know exact costs, no token drama.
              </p>
            </div>

            {/* Column 2: Contact */}
            <div>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 24, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 0 }}>
                Contact
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <a href="mailto:support@dendrites.ai" className="qp-footer-link" style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.70)", textDecoration: "none", fontSize: 13 }}>
                  <EnvelopeIcon /><span>support@dendrites.ai</span>
                </a>
                <a href="mailto:hello@dendrites.ai" className="qp-footer-link" style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.70)", textDecoration: "none", fontSize: 13 }}>
                  <EnvelopeIcon /><span>hello@dendrites.ai</span>
                </a>
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.70)", fontSize: 13 }}>
                  <LocationIcon /><span>New York, NY</span>
                </div>
              </div>
            </div>

            {/* Column 3: Follow Us */}
            <div>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 24, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 0 }}>
                Follow Us
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SocialLinkFull href="https://x.com/Dendrites_AI/status/1979407183478743352" label="X / Twitter"><XIcon /></SocialLinkFull>
                <SocialLinkFull href="https://linkedin.com/company/dendrites-ai" label="LinkedIn"><LinkedInIcon /></SocialLinkFull>
                <SocialLinkFull href="https://farcaster.xyz/dendrites" label="Farcaster"><FarcasterIcon /></SocialLinkFull>
                <SocialLinkFull href="https://t.me/Dendrites_Chat" label="Telegram"><TelegramIcon /></SocialLinkFull>
                <SocialLinkFull href="https://discord.gg/2vPu6PerTU" label="Discord"><DiscordIcon /></SocialLinkFull>
                <SocialLinkFull href="https://github.com/Dendrites-Official" label="GitHub"><GitHubIcon /></SocialLinkFull>
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.40)", fontSize: 13, cursor: "not-allowed" }}>
                  <RedditIcon style={{ color: "rgba(255,255,255,0.30)" }} />
                  <span>Reddit (Coming soon)</span>
                </div>
              </div>
            </div>

            {/* Column 4: Press & Resources */}
            <div>
              <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 24, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 0 }}>
                Press &amp; Media
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <PressLink href="https://shorturl.at/vpN6j" label="Press Release #1" />
                <PressLink href="https://shorturl.at/x7s4Y" label="Press Release #2" />
                <PressLink href="https://shorturl.at/iW9rn" label="Press Release #3" />
              </div>

              {/* Quick Links */}
              <div style={{ marginTop: 32, paddingTop: 32, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
                <h3 style={{ color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 24, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 0 }}>
                  Quick Links
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
                  <a href="/docs" className="qp-footer-link" style={{ color: "rgba(255,255,255,0.60)", textDecoration: "none" }}>Whitepaper</a>
                  <a href="/#escrow-quickpay" className="qp-footer-link" style={{ color: "rgba(255,255,255,0.60)", textDecoration: "none" }}>Experience Undo</a>
                  <a href="/roadmap" className="qp-footer-link" style={{ color: "rgba(255,255,255,0.60)", textDecoration: "none" }}>Roadmap</a>
                  <Link to="/careers" className="qp-footer-link" style={{ color: "rgba(255,255,255,0.60)", textDecoration: "none" }}>Careers</Link>
                  <Link to="/about" className="qp-footer-link" style={{ color: "rgba(255,255,255,0.60)", textDecoration: "none" }}>About Us</Link>
                </div>
              </div>
            </div>
          </div>

          {/* Company Information - Only on Docs Page */}
          {showCompanyInfo && (
            <div style={{ paddingTop: 20, marginTop: 20 }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)", margin: "0 0 4px" }}>
                  Dendrites Technology Ltd — BVI Business Company
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "4px 12px", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                  <span>Company No. 2193875</span>
                  <span style={{ color: "rgba(255,255,255,0.25)" }}>•</span>
                  <span>Incorporated 20 November 2025</span>
                  <span style={{ color: "rgba(255,255,255,0.25)" }}>•</span>
                  <span>British Virgin Islands</span>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Bar */}
          <div style={{
            paddingTop: 32, marginTop: 32,
            borderTop: "1px solid rgba(255,255,255,0.10)",
            display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16,
            flexWrap: "wrap",
          }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", lineHeight: 1.7 }}>
              © 2025 Dendrites AI<br />
              Built for commerce-grade safety
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 24px", fontSize: 13, color: "rgba(255,255,255,0.40)" }}>
              <button type="button" onClick={() => setOpenModal("privacy")} className="qp-footer-link qp-footer-btn">Privacy Policy</button>
              <button type="button" onClick={() => setOpenModal("terms")} className="qp-footer-link qp-footer-btn">Terms of Service</button>
              <button type="button" onClick={() => setOpenModal("security")} className="qp-footer-link qp-footer-btn">Security</button>
            </div>
          </div>
        </div>

        <style>{`
          .qp-footer-mobile { display: block; }
          .qp-footer-desktop { display: none; }

          @media (min-width: 640px) {
            .qp-footer-mobile { display: none; }
            .qp-footer-desktop { display: block; }
          }

          .qp-footer-link {
            transition: color 0.2s ease;
          }
          .qp-footer-link:hover {
            color: #1850eb !important;
          }

          .qp-footer-btn {
            background: none;
            border: none;
            outline: none;
            cursor: pointer;
            color: inherit;
            font-size: inherit;
            padding: 0;
            text-decoration-offset: 4px;
            font-family: inherit;
          }
          .qp-footer-btn:hover {
            text-decoration: underline;
          }

          .qp-footer-icon {
            color: rgba(100, 139, 231, 0.8);
            transition: color 0.2s ease;
            flex-shrink: 0;
          }
          .qp-footer-social-link:hover .qp-footer-icon {
            color: #1850eb !important;
          }
        `}</style>
      </footer>

      {openModal && (
        <PolicyModal type={openModal} onClose={() => setOpenModal(null)} />
      )}
    </>
  );
}

/* -------------------------------------------------
   Icon helpers
-------------------------------------------------- */
function EnvelopeIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function FarcasterIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M5 3v18l7-3 7 3V3z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function RedditIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" style={style}>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg className="qp-footer-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
    </svg>
  );
}

/* Small icon-only social link for mobile */
function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="qp-footer-link qp-footer-social-link"
      style={{ color: "rgba(255,255,255,0.70)", textDecoration: "none" }}
    >
      {children}
    </a>
  );
}

/* Full icon + label social link for desktop */
function SocialLinkFull({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="qp-footer-link qp-footer-social-link"
      style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.70)", textDecoration: "none", fontSize: 13 }}
    >
      {children}
      <span>{label}</span>
    </a>
  );
}

/* Press link row */
function PressLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="qp-footer-link qp-footer-social-link"
      style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.70)", textDecoration: "none", fontSize: 13 }}
    >
      <NewsIcon />
      <span>{label}</span>
    </a>
  );
}
