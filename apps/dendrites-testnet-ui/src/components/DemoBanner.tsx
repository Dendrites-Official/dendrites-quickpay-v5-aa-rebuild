import { useEffect } from "react";
import { useAppMode } from "../demo/AppModeContext";
import { DEMO_VIDEO_URL } from "../demo/demoData";
import { useDemoReceiptsStore } from "../demo/DemoReceiptsStore";
import { useDemoAckLinkStore } from "../demo/demoAckLinkStore";
import { resetDemoSeedFlag, seedDemo } from "../demo/seedDemo";

export default function DemoBanner() {
  const { isDemo, setDemo } = useAppMode();
  const { receipts, addReceipt, clearReceipts } = useDemoReceiptsStore();
  const { clearLinks } = useDemoAckLinkStore();

  useEffect(() => {
    if (!isDemo) return;
    seedDemo(addReceipt, receipts.length);
  }, [addReceipt, isDemo, receipts.length]);

  if (!isDemo) return null;

  const hasVideo = Boolean(DEMO_VIDEO_URL && /^https?:/i.test(DEMO_VIDEO_URL));

  const handleResetDemo = () => {
    clearReceipts();
    clearLinks();
    resetDemoSeedFlag();
    seedDemo(addReceipt, 0, { force: true });
  };

  return (
    <div className="dx-banner dx-bannerDemo" role="status">
      <div className="dx-bannerInner dx-bannerInnerDemo">
        <span className="dx-bannerDot dx-bannerDotDemo" aria-hidden="true" />
        <div className="dx-bannerText">
          <div className="dx-bannerTitle">Demo mode</div>
          <div className="dx-bannerBody">
            Transactions are disabled. Explore the full UI. Turn off Demo mode to connect and transact.
          </div>
        </div>
        <div className="dx-bannerActions">
          <button type="button" className="dx-bannerBtn" onClick={() => setDemo(false)}>
            Turn off demo
          </button>
          <button type="button" className="dx-bannerBtn dx-bannerBtnGhost" onClick={handleResetDemo}>
            Reset demo
          </button>
          {hasVideo ? (
            <a className="dx-bannerBtn dx-bannerBtnGhost" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
              Watch demo video
            </a>
          ) : (
            <button type="button" className="dx-bannerBtn dx-bannerBtnGhost" disabled>
              Watch demo video
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
