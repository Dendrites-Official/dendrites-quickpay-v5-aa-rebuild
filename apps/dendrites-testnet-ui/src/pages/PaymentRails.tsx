import { useNavigate } from "react-router-dom";
import "../styles/payment-rails.css";

type Rail = {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
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
        "dx-railBtn",
        "dx-railCard",
        `dx-rail-${rail.accent}`,
        rail.featured ? "is-featured" : "",
        disabled ? "is-disabled" : "",
      ].join(" ")}
      onClick={() => !disabled && onOpen(rail)}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <div className="dx-railChrome" aria-hidden="true" />
      <div className="dx-railInner">
        <div className="dx-railHead">
          <div className="dx-railIcon" aria-hidden="true">
            <Icon name={iconName as any} />
          </div>

          <div className="dx-railMeta">
            <div className={`dx-railPill ${rail.status === "live" ? "is-live" : "is-soon"}`}>
              {rail.status === "live" ? "Live" : "Soon"}
            </div>
            {rail.featured ? <div className="dx-railPill is-reco">Recommended</div> : null}
          </div>
        </div>

        <div className="dx-railText">
          <h2 className="dx-railTitle">{rail.title}</h2>
          <p className="dx-railSub">{rail.subtitle}</p>

          <div className="dx-railTags" aria-label="Highlights">
            {rail.tags.map((t) => (
              <span key={t} className="dx-railTag">
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="dx-railFoot">
          <span className="dx-railCta">{disabled ? "Planned" : "Open"}</span>
          <span className="dx-railArrow" aria-hidden="true">
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
      tags: ["Shareable link", "Claim later", "Receipts"],
      route: "/ack",
      accent: "violet",
      status: "live",
    },
    {
      id: "bulkpay",
      title: "Bulk Pay",
      subtitle: "Paste recipients and execute in one session. Built for payouts.",
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
      tags: ["Cancel window", "Mistake protection", "Planned"],
      accent: "neutral",
      status: "soon",
    },
    {
      id: "escrow",
      title: "Escrow Payments",
      subtitle: "Hold funds until delivery or milestone release. Real escrow UX.",
      tags: ["Hold & release", "Milestones", "Planned"],
      accent: "neutral",
      status: "soon",
    },
  ];

  return (
    <main className="dx-container dx-rails">
      <header className="dx-railsHero">
        <div className="dx-kicker">DENDRITES</div>
        <h1 className="dx-railsH1">Select a payment rail</h1>
        <p className="dx-railsP">
          Minimal clicks. Premium surfaces. Same underlying AA stack — different UX flows.
        </p>
      </header>

      <section className="dx-railsSection">
        <div className="dx-railsSectionHead">
          <h2 className="dx-railsSectionTitle">Available</h2>
          <div className="dx-railsSectionHint">Optimized for mobile and wallets.</div>
        </div>

        <div className="dx-railsGrid">
          {live.map((r) => (
            <RailCard key={r.id} rail={r} onOpen={(x) => x.route && navigate(x.route)} />
          ))}
        </div>
      </section>

      <section className="dx-railsSection dx-railsPlanned">
        <div className="dx-railsSectionHead">
          <h2 className="dx-railsSectionTitle">Planned</h2>
          <div className="dx-railsSectionHint">Shown for visibility. Disabled until shipped.</div>
        </div>

        <div className="dx-railsGrid dx-railsGridPlanned">
          {planned.map((r) => (
            <RailCard key={r.id} rail={r} onOpen={() => {}} />
          ))}
        </div>
      </section>

      <section className="dx-card dx-railsNote">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h3 className="dx-card-title">What you get</h3>
            <p className="dx-card-hint">Across rails</p>
          </div>

          <div className="dx-railsMini">
            <div className="dx-railsMiniItem">
              <div className="dx-railsMiniTop">Receipts</div>
              <div className="dx-railsMiniSub">Every flow produces trackable output.</div>
            </div>
            <div className="dx-railsMiniItem">
              <div className="dx-railsMiniTop">Predictable UX</div>
              <div className="dx-railsMiniSub">Same controls, different rails.</div>
            </div>
            <div className="dx-railsMiniItem">
              <div className="dx-railsMiniTop">Premium surfaces</div>
              <div className="dx-railsMiniSub">No clutter. No noisy gradients.</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
