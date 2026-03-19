import { useNavigate } from "react-router-dom";
import "../styles/payment-rails.css";

type Rail = {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  blurb: string;
  route?: string;
  accent: "blue" | "violet" | "green" | "neutral";
  status: "live" | "soon";
  featured?: boolean;
};

function Icon({ name }: { name: "bolt" | "link" | "box" | "undo" | "escrow" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "bolt":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M13 2 3 14h8l-1 8 11-14h-8V2Z" />
        </svg>
      );
    case "link":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M10 13a5 5 0 0 1 0-7l1.2-1.2a5 5 0 0 1 7 7L17 13" />
          <path {...common} d="M14 11a5 5 0 0 1 0 7l-1.2 1.2a5 5 0 0 1-7-7L7 11" />
        </svg>
      );
    case "box":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M4.5 7.5 12 3l7.5 4.5V16.5L12 21l-7.5-4.5V7.5Z" />
          <path {...common} d="M12 21V12m7.5-4.5L12 12 4.5 7.5" />
        </svg>
      );
    case "undo":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M7 7H3V3" />
          <path {...common} d="M3 7a9 9 0 1 1 3 10" />
        </svg>
      );
    case "escrow":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M12 2 20 6v6c0 5-3.3 9.4-8 10-4.7-.6-8-5-8-10V6l8-4Z" />
          <path {...common} d="M9.3 12.3 11 14l3.7-4.2" />
        </svg>
      );
    default:
      return null;
  }
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 18l6-6-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RailCard({
  rail,
  onOpen,
}: {
  rail: Rail;
  onOpen: (rail: Rail) => void;
}) {
  const disabled = rail.status !== "live" || !rail.route;

  const iconName =
    rail.id === "quickpay"
      ? "bolt"
      : rail.id === "acklink"
      ? "link"
      : rail.id === "bulkpay"
      ? "box"
      : rail.id === "undo"
      ? "undo"
      : "escrow";

  return (
    <button
      type="button"
      className={[
        "dx-railsCard",
        `dx-railsCard-${rail.accent}`,
        rail.featured ? "is-featured" : "",
        disabled ? "is-disabled" : "",
      ].join(" ")}
      onClick={() => !disabled && onOpen(rail)}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <div className="dx-railsCardGlow" aria-hidden="true" />
      <div className="dx-railsCardInner">
        <div className="dx-railsCardTop">
          <div className="dx-railsIcon" aria-hidden="true">
            <Icon name={iconName as any} />
          </div>

          <div className="dx-railsMeta">
            <div className={`dx-railsPill ${rail.status === "live" ? "is-live" : "is-soon"}`}>
              {rail.status === "live" ? "Live" : "Soon"}
            </div>
            {rail.featured ? <div className="dx-railsPill is-reco">Recommended</div> : null}
          </div>
        </div>

        <div className="dx-railsCopy">
          <div className="dx-railsEyebrow">{rail.featured ? "Primary rail" : rail.status === "live" ? "Available now" : "On roadmap"}</div>
          <h2 className="dx-railsTitle">{rail.title}</h2>
          <p className="dx-railsSubtitle">{rail.subtitle}</p>
          <p className="dx-railsBlurb">{rail.blurb}</p>

          <div className="dx-railsTags" aria-label="Highlights">
            {rail.tags.map((t) => (
              <span key={t} className="dx-railsTag">
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="dx-railsFoot">
          <span className="dx-railsCta">{disabled ? "Planned" : "Open rail"}</span>
          <span className="dx-railsArrow" aria-hidden="true">
            <Arrow />
          </span>
        </div>
      </div>
    </button>
  );
}

export default function PaymentRails() {
  const navigate = useNavigate();

  const live: Rail[] = [
    {
      id: "quickpay",
      title: "QuickPay",
      subtitle: "Single-send flow with a clean quote → send → receipt path.",
      blurb: "Best when you want one polished payment flow with receipts and minimal decision overhead.",
      tags: ["Fast", "One recipient", "Receipts"],
      route: "/quickpay",
      accent: "blue",
      status: "live",
      featured: true,
    },
    {
      id: "acklink",
      title: "AckLink",
      subtitle: "Create a link. Share it. Claim later — controlled acceptance.",
      blurb: "Useful for handoffs, approvals, and any payment where the recipient should actively acknowledge before completion.",
      tags: ["Shareable link", "Claim later", "Receipts"],
      route: "/ack",
      accent: "violet",
      status: "live",
    },
    {
      id: "bulkpay",
      title: "Bulk Pay",
      subtitle: "Paste recipients and execute in one session. Built for payouts.",
      blurb: "Designed for operational batches where one send path and one result surface matter more than one-off polish.",
      tags: ["Many recipients", "One quote", "One send"],
      route: "/bulk",
      accent: "green",
      status: "live",
    },
  ];

  const planned: Rail[] = [
    {
      id: "undo",
      title: "UNDO Payments",
      subtitle: "A cancel window for wrong-address sends. Safety-first by design.",
      blurb: "Planned safety rail focused on reducing sender anxiety and providing a small reversal window for mistakes.",
      tags: ["Cancel window", "Mistake protection", "Planned"],
      accent: "neutral",
      status: "soon",
    },
    {
      id: "escrow",
      title: "Escrow Payments",
      subtitle: "Hold funds until delivery or milestone release. Real escrow UX.",
      blurb: "Planned release flow for milestone-based work, conditional fulfillment, and stronger buyer-seller coordination.",
      tags: ["Hold & release", "Milestones", "Planned"],
      accent: "neutral",
      status: "soon",
    },
  ];

  return (
    <main className="dx-container dx-railsPage">
      <header className="dx-railsHero">
        <div className="dx-kicker">Dendrites</div>
        <h1 className="dx-railsHeroTitle">Choose the rail that fits the payment.</h1>
        <p className="dx-railsHeroLead">
          Same stack underneath. Different user experiences on top. Pick the flow that matches how the sender and
          recipient should move through the payment.
        </p>
        <div className="dx-railsHeroPills">
          <span className="dx-railsHeroPill">Wallet-friendly</span>
          <span className="dx-railsHeroPill">Mobile-ready</span>
          <span className="dx-railsHeroPill">Receipt-first</span>
        </div>
      </header>

      <section className="dx-railsBlock dx-railsBlockAvailable">
        <div className="dx-railsBlockHead">
          <div>
            <div className="dx-railsSectionKicker">Available</div>
            <h2 className="dx-railsSectionTitle">Live rails</h2>
          </div>
          <div className="dx-railsSectionHint">Built to read clearly on phone, tablet, and desktop.</div>
        </div>

        <div className="dx-railsGrid">
          {live.map((r) => (
            <RailCard key={r.id} rail={r} onOpen={(x) => x.route && navigate(x.route)} />
          ))}
        </div>
      </section>

      <section className="dx-railsBlock dx-railsBlockPlanned">
        <div className="dx-railsBlockHead">
          <div>
            <div className="dx-railsSectionKicker">Planned</div>
            <h2 className="dx-railsSectionTitle">Next rails</h2>
          </div>
          <div className="dx-railsSectionHint">Visible for direction, but not active yet.</div>
        </div>

        <div className="dx-railsGrid dx-railsGridPlanned">
          {planned.map((r) => (
            <RailCard key={r.id} rail={r} onOpen={() => {}} />
          ))}
        </div>
      </section>

      <section className="dx-card dx-railsNote">
        <div className="dx-card-in">
          <div className="dx-card-head dx-railsNoteHead">
            <h3 className="dx-card-title">Across rails</h3>
            <p className="dx-card-hint">Consistent system behavior</p>
          </div>

          <div className="dx-railsMini">
            <div className="dx-railsMiniItem">
              <div className="dx-railsMiniTop">Receipts</div>
              <div className="dx-railsMiniSub">Every flow lands in a trackable confirmation surface.</div>
            </div>
            <div className="dx-railsMiniItem">
              <div className="dx-railsMiniTop">Predictable UX</div>
              <div className="dx-railsMiniSub">The interaction model stays familiar even when the rail changes.</div>
            </div>
            <div className="dx-railsMiniItem">
              <div className="dx-railsMiniTop">Responsive layout</div>
              <div className="dx-railsMiniSub">Cards collapse cleanly for smaller screens without losing hierarchy.</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
