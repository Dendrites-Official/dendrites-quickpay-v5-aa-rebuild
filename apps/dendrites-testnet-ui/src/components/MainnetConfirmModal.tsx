import React from "react";

type Props = {
  open: boolean;
  summary: string;
  gasEstimate: string | null;
  gasEstimateError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function MainnetConfirmModal({
  open,
  summary,
  gasEstimate,
  gasEstimateError,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <div style={{ background: "#111", padding: 16, borderRadius: 8, border: "1px solid #333", maxWidth: 520 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Mainnet confirmation</div>
        <div style={{ color: "#bdbdbd", marginBottom: 12 }}>You will spend real gas.</div>
        <div style={{ marginBottom: 10 }}><strong>Action:</strong> {summary}</div>
        <div style={{ marginBottom: 12 }}>
          <strong>Estimated gas cost:</strong>{" "}
          {gasEstimate ? gasEstimate : "Unable to estimate; wallet will show final gas."}
          {gasEstimateError ? (
            <div style={{ color: "#bdbdbd", marginTop: 4 }}>{gasEstimateError}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onConfirm}>I Understand, Continue</button>
        </div>
      </div>
    </div>
  );
}
