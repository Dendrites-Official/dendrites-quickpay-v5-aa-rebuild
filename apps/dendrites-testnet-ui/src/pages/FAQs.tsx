export default function FAQs() {
  const faqs = [
    {
      q: "What is Dendrites?",
      a: "Dendrites is a payment platform built on account abstraction, allowing for seamless blockchain transactions with sponsored gas fees.",
    },
    {
      q: "How does QuickPay work?",
      a: "QuickPay allows you to send instant payments to any address. Simply enter the recipient, amount, and token type.",
    },
    {
      q: "What is AckLink?",
      a: "AckLink lets you create shareable payment links that anyone can claim. Perfect for airdrops or sharing payments.",
    },
    {
      q: "Can I send to multiple recipients?",
      a: "Yes! Use our Bulk Pay feature to send payments to multiple addresses in a single transaction.",
    },
    {
      q: "Do I need to pay gas fees?",
      a: "No! We sponsor gas fees for you through our paymaster system.",
    },
    {
      q: "Which networks are supported?",
      a: "Currently, we support multiple EVM-compatible testnets. Check the network selector in your wallet.",
    },
  ];

  return (
    <div className="dx-container">
      <h1 className="dx-h1" style={{ marginBottom: "12px" }}>Frequently Asked Questions</h1>
      <p className="dx-sub" style={{ marginBottom: "40px" }}>
        Find answers to common questions about Dendrites payment rails
      </p>

      <div style={{ maxWidth: "800px" }}>
        {faqs.map((faq, i) => (
          <div key={i} className="dx-card" style={{ marginBottom: "16px" }}>
            <div className="dx-card-in">
              <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "12px", color: "#fff" }}>
                {faq.q}
              </h3>
              <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.75)", margin: 0, lineHeight: "1.6" }}>
                {faq.a}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="dx-card" style={{ marginTop: "40px", maxWidth: "800px" }}>
        <div className="dx-card-in">
          <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "12px" }}>Still have questions?</h3>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.75)", marginBottom: "20px" }}>
            Visit our support page or reach out to our team
          </p>
          <a href="/support" className="dx-primary" style={{ display: "inline-block", padding: "10px 20px", borderRadius: "12px", textDecoration: "none" }}>
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
