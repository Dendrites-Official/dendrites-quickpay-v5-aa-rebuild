import { Link, Routes, Route, Navigate } from "react-router-dom";
import QuickPay from "./pages/QuickPay";
import Receipts from "./pages/Receipts";
import ReceiptsList from "./pages/ReceiptsList";
import WalletButton from "./components/WalletButton";

function Nav() {
  return (
    <div style={{ display: "flex", gap: 12, padding: 16, borderBottom: "1px solid #333", alignItems: "center" }}>
      <Link to="/quickpay">QuickPay</Link>
      <Link to="/receipts">Receipts</Link>
      <div style={{ marginLeft: "auto" }}>
        <WalletButton />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to="/quickpay" replace />} />
        <Route path="/quickpay" element={<QuickPay />} />
        <Route path="/receipts" element={<ReceiptsList />} />
        <Route path="/receipts/:id" element={<Receipts />} />
        <Route path="/r/:id" element={<Receipts />} />
      </Routes>
    </div>
  );
}
