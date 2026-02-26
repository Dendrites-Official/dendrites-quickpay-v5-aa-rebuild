export default function Support() {
  return (
    <div className="dx-container">
      <h1 className="dx-h1" style={{ marginBottom: "12px" }}>Support</h1>
      <p className="dx-sub" style={{ marginBottom: "40px" }}>
        Get help with Dendrites payment platform
      </p>

      <div style={{ maxWidth: "800px" }}>
        <div className="dx-card" style={{ marginBottom: "20px" }}>
          <div className="dx-card-in">
            <h3 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "16px" }}>📧 Email Support</h3>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.75)", marginBottom: "12px" }}>
              Send us an email and we'll get back to you within 24 hours.
            </p>
            <a
              href="mailto:support@dendrites.ai"
              style={{
                color: "#0070f3",
                textDecoration: "none",
                fontWeight: "600",
              }}
            >
              support@dendrites.ai
            </a>
          </div>
        </div>

        <div className="dx-card" style={{ marginBottom: "20px" }}>
          <div className="dx-card-in">
            <h3 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "16px" }}>💬 Community</h3>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.75)", marginBottom: "16px" }}>
              Join our community channels for real-time support and updates.
            </p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <a
                className="dx-primary"
                href="https://discord.gg/2vPu6PerTU"
                target="_blank"
                rel="noreferrer"
                style={{ padding: "10px 20px", display: "inline-flex", alignItems: "center" }}
              >
                Discord
              </a>
              <a
                className="dx-primary"
                href="https://t.me/Dendrites_Chat"
                target="_blank"
                rel="noreferrer"
                style={{ padding: "10px 20px", display: "inline-flex", alignItems: "center" }}
              >
                Telegram
              </a>
              <a
                className="dx-primary"
                href="https://x.com/Dendrites_AI"
                target="_blank"
                rel="noreferrer"
                style={{ padding: "10px 20px", display: "inline-flex", alignItems: "center" }}
              >
                X (Twitter)
              </a>
            </div>
          </div>
        </div>

        <div className="dx-card">
          <div className="dx-card-in">
            <h3 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "16px" }}>📚 Resources</h3>
            <ul style={{ margin: 0, padding: "0 0 0 20px", color: "rgba(255,255,255,0.75)" }}>
              <li style={{ marginBottom: "12px" }}>
                <a href="/faqs" style={{ color: "#0070f3", textDecoration: "none" }}>
                  Frequently Asked Questions
                </a>
              </li>
              <li style={{ marginBottom: "12px" }}>
                <a href="/wallet" style={{ color: "#0070f3", textDecoration: "none" }}>
                  Wallet Health Dashboard
                </a>
              </li>
              <li style={{ marginBottom: "12px" }}>
                <a href="/receipts" style={{ color: "#0070f3", textDecoration: "none" }}>
                  Receipt Explorer
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="dx-alert" style={{ marginTop: "40px" }}>
          <strong>Note:</strong> For urgent issues related to transactions, please include your transaction hash or
          receipt ID when contacting support.
        </div>
      </div>
    </div>
  );
}
