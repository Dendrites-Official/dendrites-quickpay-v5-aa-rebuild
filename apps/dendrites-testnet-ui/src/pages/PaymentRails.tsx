import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/payment-rails.css";

type Rail = {
  id: string;
  title: string;
  role: string;
  quote: string;
  tags: string[];
  route?: string;
  status: "live" | "planned";
  accent: "blue" | "violet" | "green" | "neutral";
  size: "tall" | "mid" | "short";
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
  }
}

function RailCard({ rail, onOpen }: { rail: Rail; onOpen: (r: Rail) => void }) {
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
        "dx-sayCard",
        `dx-say-${rail.accent}`,
        `is-${rail.size}`,
        disabled ? "is-disabled" : "",
      ].join(" ")}
      onClick={() => !disabled && onOpen(rail)}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <div className="dx-sayTop">
        <div className="dx-sayAvatar" aria-hidden="true">
          <Icon name={iconName} />
        </div>

        <div className="dx-sayNameBlock">
          <div className="dx-sayName">{rail.title}</div>
          <div className="dx-sayRole">{rail.role}</div>
        </div>

        <div className={`dx-sayPill ${rail.status === "live" ? "is-live" : "is-planned"}`}>
          {rail.status === "live" ? "Live" : "Planned"}
        </div>
      </div>

      <div className="dx-sayQuote">“{rail.quote}”</div>

      <div className="dx-sayTags" aria-label="Highlights">
        {rail.tags.map((t) => (
          <span key={t} className="dx-sayTag">
            {t}
          </span>
        ))}
      </div>

      <div className="dx-sayFoot">
        <span className="dx-sayFootLeft">{disabled ? "Coming soon" : "Open rail"}</span>
        <span className="dx-sayFootRight">{disabled ? "Planned" : "Ready"}</span>
      </div>
    </button>
  );
}

export default function PaymentRails() {
  const navigate = useNavigate();

  // Set to your real Ack route:
  const ACK_ROUTE = "/ack"; // or "/acklink/create"

  const rails: Rail[] = useMemo(
    () => [
      {
        id: "quickpay",
        title: "QuickPay",
        role: "Live rail",
        quote: "Multiple authorization paths. One premium send flow. Receipts by default.",
        tags: ["Fast", "Receipts", "Single send"],
        route: "/quickpay",
        status: "live",
        accent: "blue",
        size: "tall",
      },
      {
        id: "acklink",
        title: "AckLink",
        role: "Live rail",
        quote: "Create a link. Share it. Claim later — controlled acceptance with receipts.",
        tags: ["Share link", "Claim later", "2-step"],
        route: ACK_ROUTE,
        status: "live",
        accent: "violet",
        size: "tall",
      },
      {
        id: "bulkpay",
        title: "Bulk Pay",
        role: "Live rail",
        quote: "Batch payouts in one session with a clean, trackable trail.",
        tags: ["Batch", "Many recipients", "Receipts"],
        route: "/bulk",
        status: "live",
        accent: "green",
        size: "mid",
      },
      {
        id: "undo",
        title: "UNDO Payments",
        role: "Planned rail",
        quote: "A cancel window for wrong-address sends. Safety-first by design.",
        tags: ["Cancel window", "Protection", "Planned"],
        status: "planned",
        accent: "neutral",
        size: "mid",
      },
      {
        id: "escrow",
        title: "Escrow Payments",
        role: "Planned rail",
        quote: "Hold funds until delivery or milestone release. Real escrow UX.",
        tags: ["Hold + release", "Milestones", "Planned"],
        status: "planned",
        accent: "neutral",
        size: "mid",
      },
    ],
    [ACK_ROUTE]
  );

  // Staggered columns: A starts up, B starts a bit down (like your screenshot)
  const columns = useMemo(() => {
    const a: Rail[] = [];
    const b: Rail[] = [];
    rails.forEach((r, i) => (i % 2 === 0 ? a : b).push(r));
    return { a, b };
  }, [rails]);

  const onOpen = useCallback(
    (r: Rail) => {
      if (r.route) navigate(r.route);
    },
    [navigate]
  );

  return (
    <main className="dx-sayPage">
      <div className="dx-sayLayout">
        {/* LEFT: sticky text (matches reference behavior) */}
        <aside className="dx-sayLeft" aria-label="Intro">
          <div className="dx-saySticky">
            <h1 className="dx-sayH1">
              <span className="dx-sayH1Faint">What we</span>
              <br />
              <span className="dx-sayH1Strong">ship with rails</span>
            </h1>

            <p className="dx-sayLead">
              Premium payment paths with predictable UX. Pick a rail that matches the wallet + token —
              the controls stay consistent, the authorization changes.
            </p>
          </div>
        </aside>

        {/* RIGHT: 2-column card wall (staggered like the screenshot) */}
        <section className="dx-sayRight" aria-label="Payment rails">
          <div className="dx-sayCols" role="list">
            <div className="dx-sayCol dx-sayColA">
              {columns.a.map((r) => (
                <RailCard key={r.id} rail={r} onOpen={onOpen} />
              ))}
            </div>

            <div className="dx-sayCol dx-sayColB">
              {columns.b.map((r) => (
                <RailCard key={r.id} rail={r} onOpen={onOpen} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}