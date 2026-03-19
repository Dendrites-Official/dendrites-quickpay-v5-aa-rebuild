import { useState } from "react";
import { Link } from "react-router-dom";

type FaqItem = {
  question: string;
  answer: string;
};

const FAQS: FaqItem[] = [
  {
    question: "What is Dendrites?",
    answer:
      "Dendrites is a payments UI for EVM rails. It focuses on clarity: predictable flows, clean confirmations, and receipts by default.",
  },
  {
    question: "What are payment rails?",
    answer:
      "Payment rails are the transaction paths behind each flow. In this UI they include direct sends, sponsored sends, link-based claims, and bulk payouts, each with its own confirmation and receipt model.",
  },
  {
    question: "How does QuickPay work?",
    answer:
      "QuickPay prepares the transfer, checks the best supported authorization lane, and routes the send through the configured contracts so the user gets a clean send flow and a receipt at the end.",
  },
  {
    question: "What is AckLink?",
    answer:
      "AckLink creates a claimable payment link. You fund it once, share the link and code separately, and the recipient claims it through a guided flow with receipt tracking.",
  },
  {
    question: "Can I send to multiple recipients?",
    answer:
      "Yes. Use Bulk Pay to send a batch of payouts in one flow. It is designed for repeated transfers where you want one submission path and one place to review the result.",
  },
  {
    question: "Do I need to pay gas?",
    answer:
      "It depends on the mode. Sponsored flows can cover gas for the user, while self-pay flows use the connected wallet normally. The UI makes that visible before final submission.",
  },
  {
    question: "Which networks are supported?",
    answer:
      "This build is centered on Base Sepolia for testing, with support checks and explorer integrations surfaced inside the wallet tools and receipt views.",
  },
  {
    question: "What are UNDO and Escrow?",
    answer:
      "They are roadmap/payment-rail concepts shown in the broader product language. This testnet UI is currently focused on QuickPay, AckLink, Bulk Pay, receipts, and wallet diagnostics.",
  },
];

export default function FAQs() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <main className="dx-container dx-faqPage">
      <section className="dx-faqHero">
        <h1 className="dx-faqTitle">Frequently asked questions</h1>
        <p className="dx-faqSub">Everything about rails, receipts, and what&apos;s live vs planned, in one place.</p>
      </section>

      <section className="dx-faqList" aria-label="Frequently asked questions">
        {FAQS.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <article
              key={item.question}
              className={`dx-faqItem ${isOpen ? "dx-faqItemOpen" : ""}`}
            >
              <button
                type="button"
                className="dx-faqTrigger"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex((current) => (current === index ? -1 : index))}
              >
                <span className="dx-faqQuestion">{item.question}</span>
                <span className="dx-faqIcon" aria-hidden="true">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen ? (
                <div className="dx-faqAnswerWrap">
                  <div className="dx-faqAnswerDivider" />
                  <p className="dx-faqAnswer">{item.answer}</p>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <div className="dx-faqFooterNote">
        If you need deeper diagnostics, use <Link to="/qa-wallet">Wallet QA</Link>, <Link to="/admin">Admin page</Link>.
      </div>
    </main>
  );
}
