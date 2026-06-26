import { useCallback, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "../styles/home.css";

function ArrowIcon() {
  return (
    <svg className="dx-homeBtnIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M7 12h9m0 0-4-4m4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CornerArrow() {
  return (
    <span className="dx-bCornerBtn" aria-hidden="true">
      ↗
    </span>
  );
}

type RailKey = "ack" | "quick" | "bulk" | "undo" | "escrow";

type Rail = {
  key: RailKey;
  status: "LIVE" | "PLANNED";
  pill: string; // "2-step" / "Fast" / "Batch" / "Planned"
  small: string; // small word
  big: string;   // big word
  desc: string;
  to?: string;
};

// function IconStrip() {

//   const items = ["▶", "⌘", "X", "M", "N"];
//   return (
//     <div className="dx-bIconStrip" aria-hidden="true">
//       {items.map((t, i) => (
//         <div key={i} className="dx-bIconBtn">
//           {t}
//         </div>
//       ))}
//     </div>
//   );
// }

function AvatarMosaic() {
  return (
    <div className="dx-bAvatarMosaic" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="dx-bAvatarTile" />
      ))}
    </div>
  );
}

function AuthPillsRow() {
  const labels = ["PERMIT2", "EIP-3009", "EIP-2612", "SELF"];
  return (
    <div className="dx-bAuthPillsRow" aria-hidden="true">
      {labels.map((x) => (
        <div key={x} className="dx-bAuthPill">
          {x}
        </div>
      ))}
    </div>
  );
}

function ReceiptStack() {
  return (
    <div className="dx-bStack" aria-hidden="true">
      <div className="dx-bStackCard s1" />
      <div className="dx-bStackCard s2" />
      <div className="dx-bStackCard s3" />
    </div>
  );
}

function OrbitDecor() {
  return (
    <div className="dx-bOrbits" aria-hidden="true">
      <div className="dx-bOrbit o1" />
      <div className="dx-bOrbit o2" />
      <div className="dx-bOrbit o3" />

      <div className="dx-bFloatChip c1">P2</div>
      <div className="dx-bFloatChip c2">3009</div>
      <div className="dx-bFloatChip c3">2612</div>
    </div>
  );
}

function RailCard({ rail }: { rail: Rail }) {
  const clickable = !!rail.to;

  const content = (
    <div className={`dx-bCardInner dx-bKind-${rail.key}`}>
      <div className="dx-bHeader">
        <div className="dx-bStatus">{rail.status}</div>
        <div className="dx-bHeaderRight">
          <div className="dx-bPill">{rail.pill}</div>
          <CornerArrow />
        </div>
      </div>

      {/* DECOR (per-card) */}
      {rail.key === "ack" ? <OrbitDecor /> : null}
      {rail.key === "quick" ? <div className="dx-bDots" aria-hidden="true" /> : null}
      {/* {rail.key === "bulk" ? <IconStrip /> : null} */}
      {rail.key === "undo" ? <AuthPillsRow /> : null}
      {rail.key === "escrow" ? <ReceiptStack /> : null}

      {/* Optional “extra” visuals to mimic reference */}
      {rail.key === "undo" ? <AvatarMosaic /> : null}

      {/* CONTENT — title sits LOWER like the reference */}
      <div className={`dx-bBody ${rail.key === "undo" ? "dx-bBodyCenter" : ""}`}>
        <div className="dx-bTitle">
          <div className="dx-bSmall">{rail.small}</div>
          <div className="dx-bBig">{rail.big}</div>
        </div>

        <div className="dx-bDesc">{rail.desc}</div>

        <div className="dx-bDivider" />

        <div className="dx-bFooter">
          <div className="dx-bFootLeft">{clickable ? "Open rail" : "Coming soon"}</div>
          <div className="dx-bFootRight">{rail.status === "LIVE" ? "Live" : "Planned"}</div>
        </div>
      </div>
    </div>
  );

  const cls = `dx-bCard dx-bArea-${rail.key} ${clickable ? "dx-bClickable" : "dx-bDisabled"}`;

  return clickable ? (
    <Link to={rail.to!} className={cls} aria-label={`${rail.small} ${rail.big}`}>
      {content}
    </Link>
  ) : (
    <div className={cls} aria-disabled="true">
      {content}
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();

  const rails: Rail[] = useMemo(
    () => [
      {
        key: "ack",
        status: "LIVE",
        pill: "2-step",
        small: "Ack",
        big: "Link",
        desc: "Send → Acknowledge → Release. Confirmation-first payments.",
        to: "/ack",
      },
      {
        key: "quick",
        status: "LIVE",
        pill: "Fast",
        small: "Quick",
        big: "Pay",
        desc: "Multiple auth paths. One premium payment UI. Receipts by default.",
        to: "/quickpay",
      },
      {
        key: "bulk",
        status: "LIVE",
        pill: "Batch",
        small: "Bulk",
        big: "Pay",
        desc: "Batch payments with receipt-friendly tracking.",
        to: "/bulk",
      },
      {
        key: "undo",
        status: "PLANNED",
        pill: "Planned",
        small: "Undo",
        big: "Window",
        desc: "Short reversal window to reduce wrong-address anxiety.",
      },
      {
        key: "escrow",
        status: "PLANNED",
        pill: "Planned",
        small: "Escrow",
        big: "Refunds",
        desc: "Conditional release + refunds for services and digital goods.",
      },
    ],
    []
  );

  const scrollToRails = useCallback(() => {
    const el = document.getElementById("dx-rails");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    navigate("/payment-rails");
  }, [navigate]);

  useEffect(() => {
    if (location.hash === "#rails") requestAnimationFrame(() => scrollToRails());
  }, [location.hash, scrollToRails]);

  return (
    <main className="dx-homePage">
      <div className="dx-homeInner">
        {/* HERO */}
        <br />
      
      
        <section className="dx-homeHero" aria-label="Hero">
          <div className="dx-homeKicker">DENDRITES</div>

          <h1 className="dx-homeH1">
            <span className="dx-homeH1Faint">Your</span>{" "}
            <span className="dx-homeH1Strong">All-in-One</span>
            <br />
            <span className="dx-homeH1Strong">Crypto</span>{" "}
            <span className="dx-homeH1Faint">Companion</span>
          </h1>

          <p className="dx-homeLead">
            Simplify payments and on-chain flows with premium rails designed for everyone —
            from first transaction to production UX.
          </p>

          <div className="dx-homeCtas">
            <button type="button" className="dx-homeBtn dx-homeBtnPrimary" onClick={scrollToRails}>
              Get Started <ArrowIcon />
            </button>

            <Link to="/payment-rails" className="dx-homeBtn dx-homeBtnGhost">
              Explore rails
            </Link>
          </div>

          <div className="dx-homeSubline" aria-label="Meta">
            <span className="dx-homePill">base-ready</span>
            <span className="dx-homePill">receipts-first</span>
            <span className="dx-homePill">premium skin</span>
          </div>
        </section>

        <br />
        <br /><br /><br />

        {/* BENTO */}
        <section id="dx-rails" className="dx-homeRailsFull" aria-label="Payment rails">
          <div className="dx-homeRailsInner">
            {/* <div className="dx-homeSectionHead">
              <div className="dx-homeSectionKicker">PAYMENT RAILS</div>
              <h2 className="dx-homeSectionTitle">Pick a rail. Ship a clean payment flow.</h2>
              <p className="dx-homeSectionLead">
                Bento overview — small + big typography, pinned footers, premium cards.
              </p>
            </div> */}
            <div className="dx-homeSectionHead dx-quoteHead">
              <div className="dx-quoteKicker">PAYMENT RAILS</div>

              <h2 className="dx-quoteTitle">
                <span className="dx-quoteMark">“</span>
                Pick a rail. Ship a clean payment flow.
                <span className="dx-quoteMark">”</span>
               
              </h2>
               <br />
              <p className="dx-homeSectionLead">
                  Bento overview — small + big typography, pinned footers, premium cards.
                </p>
            </div>

            <div className="dx-bento" role="list">
              {rails.map((r) => (
                <RailCard key={r.key} rail={r} />
              ))}
            </div>
          </div>
        </section>


        <footer className="dx-homeFoot">
          <div className="dx-homeFootLine" />
          <div className="dx-homeFootText">Dendrites Payments UI — premium skin only. No behavior changes.</div>
        </footer>
      </div>
    </main>
  );
}