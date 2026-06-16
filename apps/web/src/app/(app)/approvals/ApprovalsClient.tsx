"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

type Approval = {
  id: string;
  department: string;
  actionType: string;
  ringLevel: number;
  status: string;
  outputContent: string;
  confidence: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type ResolveAction = "approve" | "reject";

const RING_COLORS: Record<number, string> = {
  1: "var(--ring-1)",
  2: "var(--ring-2)",
  3: "var(--ring-3)",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--yellow)",
  approved: "var(--green)",
  rejected: "var(--red)",
  expired: "var(--text-subtle)",
  modified: "var(--blue)",
};

export function ApprovalsClient() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [modifyContent, setModifyContent] = useState("");
  const [modifyingId, setModifyingId] = useState<string | null>(null);

  const loadApprovals = useCallback(async (cId: string) => {
    const rows = await api.get<Approval[]>(`/companies/${cId}/approvals`);
    setApprovals(rows);
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const companies = await api.get<{ id: string }[]>("/companies");
        const cId = companies[0]?.id;
        if (!cId) return;
        setCompanyId(cId);
        await loadApprovals(cId);
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [loadApprovals]);

  async function resolve(approvalId: string, action: ResolveAction) {
    if (!companyId || isResolving) return;
    setIsResolving(true);
    try {
      await api.post(`/companies/${companyId}/approvals/${approvalId}/resolve`, { action });
      await loadApprovals(companyId);
      setActiveId(null);
    } finally {
      setIsResolving(false);
    }
  }

  async function submitModify(approvalId: string) {
    if (!companyId || !modifyContent.trim() || isResolving) return;
    setIsResolving(true);
    try {
      await api.post(`/companies/${companyId}/approvals/${approvalId}/resolve`, {
        action: "modify",
        modifiedContent: modifyContent,
      });
      await loadApprovals(companyId);
      setModifyingId(null);
      setModifyContent("");
      setActiveId(null);
    } finally {
      setIsResolving(false);
    }
  }

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");
  const active = approvals.find((a) => a.id === activeId);

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>;

  return (
    <div style={{ display: "flex", gap: 24, maxWidth: 1100 }}>
      {/* List */}
      <div style={{ flex: "0 0 420px", display: "flex", flexDirection: "column", gap: 24 }}>
        {pending.length > 0 && (
          <section>
            <SectionHeader>Pending ({pending.length})</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {pending.map((a) => (
                <ApprovalRow
                  key={a.id}
                  approval={a}
                  isActive={a.id === activeId}
                  onClick={() => setActiveId(a.id === activeId ? null : a.id)}
                />
              ))}
            </div>
          </section>
        )}

        {resolved.length > 0 && (
          <section>
            <SectionHeader>History</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {resolved.slice(0, 20).map((a) => (
                <ApprovalRow
                  key={a.id}
                  approval={a}
                  isActive={a.id === activeId}
                  onClick={() => setActiveId(a.id === activeId ? null : a.id)}
                />
              ))}
            </div>
          </section>
        )}

        {approvals.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No approvals yet.</p>
        )}
      </div>

      {/* Detail pane */}
      {active && (
        <div
          style={{
            flex: 1,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, textTransform: "capitalize" }}>
                {active.department} — {active.actionType.replace(/_/g, " ")}
              </span>
              <RingBadge ring={active.ringLevel} />
              <StatusBadge status={active.status} />
            </div>
            {active.confidence && (
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
                Confidence: {Math.round(Number(active.confidence) * 100)}%
              </p>
            )}
            {active.expiresAt && active.status === "pending" && (
              <p style={{ color: "var(--yellow)", fontSize: 12, margin: "4px 0 0" }}>
                Expires {new Date(active.expiresAt).toLocaleString()}
              </p>
            )}
          </div>

          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border-muted)",
              borderRadius: 4,
              color: "var(--text)",
              fontSize: 12,
              maxHeight: 320,
              overflow: "auto",
              padding: "12px 16px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {active.outputContent}
          </div>

          {active.status === "pending" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {modifyingId === active.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    value={modifyContent}
                    onChange={(e) => setModifyContent(e.target.value)}
                    placeholder="Enter your modified version..."
                    rows={6}
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--text)",
                      fontFamily: "inherit",
                      fontSize: 12,
                      padding: "10px 12px",
                      resize: "vertical",
                      width: "100%",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <ActionButton
                      label={isResolving ? "Saving..." : "Save modification"}
                      onClick={() => void submitModify(active.id)}
                      variant="primary"
                      disabled={isResolving}
                    />
                    <ActionButton
                      label="Cancel"
                      onClick={() => { setModifyingId(null); setModifyContent(""); }}
                      variant="ghost"
                      disabled={isResolving}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <ActionButton
                    label={isResolving ? "..." : "Approve"}
                    onClick={() => void resolve(active.id, "approve")}
                    variant="approve"
                    disabled={isResolving}
                  />
                  <ActionButton
                    label={isResolving ? "..." : "Reject"}
                    onClick={() => void resolve(active.id, "reject")}
                    variant="reject"
                    disabled={isResolving}
                  />
                  <ActionButton
                    label="Modify"
                    onClick={() => { setModifyingId(active.id); setModifyContent(active.outputContent); }}
                    variant="ghost"
                    disabled={isResolving}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalRow({
  approval,
  isActive,
  onClick,
}: {
  approval: Approval;
  isActive: boolean;
  onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[approval.status] ?? "var(--text-muted)";

  return (
    <button
      onClick={onClick}
      style={{
        background: isActive ? "var(--surface-2)" : "var(--surface)",
        border: `1px solid ${isActive ? "var(--border-muted)" : "var(--border)"}`,
        borderRadius: 4,
        color: "inherit",
        cursor: "pointer",
        fontFamily: "inherit",
        padding: "10px 14px",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 500, textTransform: "capitalize" }}>
          {approval.department} — {approval.actionType.replace(/_/g, " ")}
        </span>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "4px 0 0" }}>
        {new Date(approval.createdAt).toLocaleDateString()}
      </p>
    </button>
  );
}

function RingBadge({ ring }: { ring: number }) {
  const color = RING_COLORS[ring] ?? "var(--text-muted)";
  return (
    <span
      style={{
        border: `1px solid ${color}`,
        borderRadius: 3,
        color,
        fontSize: 10,
        padding: "1px 5px",
      }}
    >
      Ring {ring}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--text-muted)";
  return (
    <span style={{ color, fontSize: 11, textTransform: "capitalize" }}>{status}</span>
  );
}

function ActionButton({
  label,
  onClick,
  variant,
  disabled,
}: {
  label: string;
  onClick: () => void;
  variant: "approve" | "reject" | "primary" | "ghost";
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    approve: { background: "rgba(34,197,94,0.12)", border: "1px solid var(--green)", color: "var(--green)" },
    reject: { background: "rgba(239,68,68,0.12)", border: "1px solid var(--red)", color: "var(--red)" },
    primary: { background: "var(--text)", border: "1px solid var(--text)", color: "var(--bg)" },
    ghost: { background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        opacity: disabled ? 0.5 : 1,
        padding: "7px 14px",
        ...styles[variant],
      }}
    >
      {label}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: "var(--text-muted)",
        fontSize: 11,
        fontWeight: 400,
        letterSpacing: "0.1em",
        margin: "0 0 12px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </h2>
  );
}
