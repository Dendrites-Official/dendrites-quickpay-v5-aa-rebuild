import { NavLink, Routes, Route, useLocation } from "react-router-dom";
import { useMemo, useState, useRef, useEffect } from "react";
import "./styles/dendrites-nav.css";

import Home from "./pages/Home";
import PaymentRails from "./pages/PaymentRails";
import QuickPay from "./pages/QuickPay";
import Receipts from "./pages/Receipts";
import ReceiptsList from "./pages/ReceiptsList";
import FAQs from "./pages/FAQs";
import Support from "./pages/Support";
import Faucet from "./pages/Faucet";
import TxQueue from "./pages/TxQueue";
import NonceRescue from "./pages/NonceRescue";
import WalletHealth from "./pages/WalletHealth";
import WalletQA from "./pages/WalletQA";
import AdminDashboard from "./pages/AdminDashboard";
import BulkPay from "./pages/BulkPay";
import AckLinkCreate from "./pages/acklink/AckLinkCreate";
import AckLinkClaim from "./pages/acklink/AckLinkClaim";
import WalletButton from "./components/WalletButton";
import { logAppEvent } from "./lib/appEvents";

type NavItem = { to: string; label: string; end?: boolean; dropdown?: { to: string; label: string }[] };

function Nav() {
  const [open, setOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const items: NavItem[] = useMemo(
    () => [
      { to: "/", label: "Home", end: true },
      {
        to: "/payment-rails",
        label: "Payment Rails",
        end: false,
        dropdown: [
          { to: "/quickpay", label: "QuickPay" },
          { to: "/ack", label: "AckLink" },
          { to: "/bulk", label: "Bulk Pay" },
        ],
      },
      { to: "/faucet", label: "Faucet", end: false },
      { to: "/wallet", label: "Wallet Health", end: false },
      { to: "/receipts", label: "Receipt Explorer", end: false },
      { to: "/faqs", label: "FAQs", end: false },
      { to: "/support", label: "Support", end: false },
    ],
    []
  );

  const linkClass = ({ isActive }: { isActive: boolean }) => `dx-link ${isActive ? "dx-linkActive" : ""}`;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className={`dx-navHeader ${open ? "dx-navHeaderOpen" : ""}`}>
      <div className="dx-navGlow" aria-hidden="true" />

      <div className="dx-navInner">
        {/* Brand - Mobile uses DX.jpg, Desktop uses GIF */}
        <NavLink
          to="/"
          className="dx-brand"
          onClick={() => setOpen(false)}
          aria-label="Dendrites Home"
        >
          {/* Mobile logo - DX.jpg */}
          <img
            src="/pics/DX.jpg"
            alt="DENDRITES"
            className="dx-brandLogo dx-brandLogoMobile"
            style={{
              filter: "brightness(1.2) contrast(1.1)",
            }}
          />
          {/* Desktop logo - GIF */}
          <img
            src="/videos/logo33.gif"
            alt="DENDRITES"
            className="dx-brandLogo dx-brandLogoDesktop"
            style={{
              filter: "brightness(1.2) contrast(1.1)",
              backgroundColor: "transparent",
              mixBlendMode: "screen",
            }}
          />
        </NavLink>

        {/* Desktop links */}
        <nav className="dx-links" aria-label="Primary">
          {items.map((it) =>
            it.dropdown ? (
              <div
                key={it.to}
                className="dx-dropdown"
                ref={dropdownRef}
                onMouseEnter={() => setDropdownOpen(true)}
                onMouseLeave={() => setDropdownOpen(false)}
              >
                <NavLink to={it.to} end={it.end} className={linkClass} onClick={() => setOpen(false)}>
                  <span className="dx-linkLabel">{it.label}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    style={{ marginLeft: "4px", transition: "transform 0.2s" }}
                  >
                    <path
                      d="M3 4.5L6 7.5L9 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="dx-linkUnderline" />
                </NavLink>
                {dropdownOpen && (
                  <div className="dx-dropdown-menu">
                    {it.dropdown.map((dropItem) => (
                      <NavLink
                        key={dropItem.to}
                        to={dropItem.to}
                        className="dx-dropdown-item"
                        onClick={() => {
                          setOpen(false);
                          setDropdownOpen(false);
                        }}
                      >
                        {dropItem.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <NavLink key={it.to} to={it.to} end={it.end} className={linkClass} onClick={() => setOpen(false)}>
                <span className="dx-linkLabel">{it.label}</span>
                <span className="dx-linkUnderline" />
              </NavLink>
            )
          )}
        </nav>

        {/* Right side */}
        <div className="dx-right">
          <div className="dx-walletWrap">
            <WalletButton />
          </div>

          <button
            type="button"
            className={`dx-menuBtn ${open ? "dx-menuBtnOpen" : ""}`}
            aria-expanded={open}
            aria-controls="dx-mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`dx-burger ${open ? "dx-burgerOpen" : ""}`} aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="dx-menuText">{open ? "Close" : "Menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {open && (
        <div id="dx-mobile-nav" className="dx-mobileWrap" role="navigation" aria-label="Mobile navigation">
          <div className="dx-mobileInner">
            <div className="dx-mobileGrid">
              {items.map((it) =>
                it.dropdown ? (
                  <div key={it.to} className="dx-mobile-dropdown">
                    <NavLink to={it.to} end={it.end} className={linkClass} onClick={() => setOpen(false)}>
                      <span className="dx-linkLabel">{it.label}</span>
                      <span className="dx-linkUnderline" />
                    </NavLink>
                    <div className="dx-mobile-dropdown-items">
                      {it.dropdown.map((dropItem) => (
                        <NavLink
                          key={dropItem.to}
                          to={dropItem.to}
                          className="dx-mobile-dropdown-item"
                          onClick={() => setOpen(false)}
                        >
                          <span className="dx-linkLabel">{dropItem.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ) : (
                  <NavLink key={it.to} to={it.to} end={it.end} className={linkClass} onClick={() => setOpen(false)}>
                    <span className="dx-linkLabel">{it.label}</span>
                    <span className="dx-linkUnderline" />
                  </NavLink>
                )
              )}
            </div>

            <div className="dx-mobileFooter">
              <div className="dx-mobileHint">Tip: swipe horizontally inside tables for wide data.</div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function usePageViewTelemetry() {
  const location = useLocation();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;
    void logAppEvent("page_view", { meta: { path } });
  }, [location.pathname, location.search]);
}

export default function App() {
  usePageViewTelemetry();
  const year = new Date().getFullYear();

  return (
    <div className="dx-app">
      <Nav />

      <div className="dx-banner">
        <div className="dx-bannerInner">
          <span className="dx-bannerDot" aria-hidden="true" />
          <div className="dx-bannerText">
            <span className="dx-bannerLabel">Note</span>
            We rate-limit quote/send endpoints per IP and per wallet with burst+sustained windows to prevent abuse and
            control sponsored gas costs.
          </div>
        </div>
      </div>

      <main className="dx-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/payment-rails" element={<PaymentRails />} />
          <Route path="/quickpay" element={<QuickPay />} />
          <Route path="/bulk" element={<BulkPay />} />
          <Route path="/ack" element={<AckLinkCreate />} />
          <Route path="/ack/:id" element={<AckLinkClaim />} />
          <Route path="/faqs" element={<FAQs />} />
          <Route path="/support" element={<Support />} />
          <Route path="/faucet" element={<Faucet />} />
          <Route path="/wallet" element={<WalletHealth />} />
          <Route path="/receipts" element={<ReceiptsList />} />
          <Route path="/receipts/:id" element={<Receipts />} />
          <Route path="/r/:id" element={<Receipts />} />
          <Route path="/tx-queue" element={<TxQueue />} />
          <Route path="/nonce-rescue" element={<NonceRescue />} />
          <Route path="/qa-wallet" element={<WalletQA />} />
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </main>

      <footer className="dx-footer" role="contentinfo">
        <div className="dx-footerInner">
          <div className="dx-footerBrand">
            <div className="dx-footerLogo">Dendrites</div>
            <div className="dx-footerMeta">Payments infrastructure for AI-native commerce.</div>
            <div className="dx-footerCopy">© {year} Dendrites. All rights reserved.</div>
          </div>

          <div className="dx-footerCols">
            <div className="dx-footerCol">
              <div className="dx-footerTitle">Company</div>
              <a href="https://www.dendrites.ai" target="_blank" rel="noreferrer">Main website</a>
              <a href="https://www.dendrites.ai/about" target="_blank" rel="noreferrer">About</a>
              <a href="https://www.dendrites.ai/blogs" target="_blank" rel="noreferrer">Blog</a>
              <a href="https://waitlist.dendrites.ai" target="_blank" rel="noreferrer">Waitlist</a>
            </div>

            <div className="dx-footerCol">
              <div className="dx-footerTitle">Resources</div>
              <a href="/support">Support</a>
              <a href="https://www.dendrites.ai/docs" target="_blank" rel="noreferrer">Docs</a>
              <div className="dx-footerNote">
                For terms and conditions, privacy visit
                {" "}
                <a href="https://www.dendrites.ai" target="_blank" rel="noreferrer">dendrites.ai</a>.
              </div>
            </div>

            <div className="dx-footerCol">
              <div className="dx-footerTitle">Social</div>
              <a href="https://discord.gg/2vPu6PerTU" target="_blank" rel="noreferrer">Discord</a>
              <a href="https://t.me/Dendrites_Chat" target="_blank" rel="noreferrer">Telegram</a>
              <a href="https://x.com/Dendrites_AI" target="_blank" rel="noreferrer">X</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
