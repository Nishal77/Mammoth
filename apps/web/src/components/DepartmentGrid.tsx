"use client";

import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Department = {
  id: string;
  name: string;
  status: string;
  ringLevel?: number;
  currentTask?: string;  // task type currently running (e.g. "lead_research")
};

// ─── Constants ────────────────────────────────────────────────────────────────

// Each department gets a distinct accent color so they're easy to scan at a glance
const DEPT_COLORS: Record<string, string> = {
  executive: "#3b82f6",
  sales: "#22c55e",
  marketing: "#a855f7",
  engineering: "#f97316",
  finance: "#eab308",
  hr: "#ec4899",
  research: "#14b8a6",
  content: "#6366f1",
  support: "#ef4444",
};

const RING_COLORS: Record<number, string> = {
  1: "var(--ring-1)",   // green — auto-executes
  2: "var(--ring-2)",   // yellow — 4h veto window
  3: "var(--ring-3)",   // red — explicit approval required
};

const RING_LABELS: Record<number, string> = {
  1: "Auto",
  2: "Veto",
  3: "Approval",
};

const STATUS_DOT: Record<string, string> = {
  running: "var(--green)",
  idle: "var(--text-subtle)",
  failed: "var(--red)",
  paused: "var(--yellow)",
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Responsive grid of department cards.
 * Each card shows: dept name, live status, current task, and ring level.
 */
export function DepartmentGrid({
  departments,
  companyId,
}: {
  departments: Department[];
  companyId: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {departments.map((dept) => (
        <DepartmentCard key={dept.id} dept={dept} companyId={companyId} />
      ))}
    </div>
  );
}

function DepartmentCard({ dept, companyId }: { dept: Department; companyId: string }) {
  const isRunning = dept.status === "running";
  const isFailed = dept.status === "failed";
  const deptColor = DEPT_COLORS[dept.name.toLowerCase()] ?? "var(--text-muted)";
  const statusColor = STATUS_DOT[dept.status] ?? "var(--text-subtle)";

  // Ring 3 adds a subtle red border tint — highest autonomy level means founder must act
  const borderColor = isFailed
    ? "var(--red)"
    : isRunning
    ? "var(--border-muted)"
    : "var(--border)";

  return (
    <Link href={`/departments/${dept.name}?company=${companyId}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "var(--surface)",
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
          padding: "14px 16px",
          cursor: "pointer",
          transition: "border-color 0.15s",
          minHeight: 90,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 10,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "#333";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = borderColor;
        }}
      >
        {/* Top: avatar + name + status dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {/* Dept initial — colored to differentiate each dept */}
          <span style={{
            width: 26,
            height: 26,
            borderRadius: 5,
            background: `${deptColor}18`,
            border: `1px solid ${deptColor}33`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: deptColor,
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {dept.name.slice(0, 2)}
          </span>

          <span style={{
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            textTransform: "capitalize",
            flex: 1,
            letterSpacing: "0.01em",
          }}>
            {dept.name}
          </span>

          {/* Pulsing dot — green when running, grey when idle */}
          <span style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusColor,
            flexShrink: 0,
            animation: isRunning ? "pulse 1.5s ease-in-out infinite" : "none",
          }} />
        </div>

        {/* Bottom: task/status + ring level */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            {/* Current task title when running */}
            {isRunning && dept.currentTask && (
              <span style={{
                color: "var(--blue)",
                fontSize: 10,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {dept.currentTask.replace(/_/g, " ")}
              </span>
            )}

            {/* Status text */}
            <span style={{
              color: isRunning ? statusColor : isFailed ? "var(--red)" : "var(--text-muted)",
              fontSize: 11,
              textTransform: "capitalize",
            }}>
              {dept.status}
            </span>
          </div>

          {/* Ring level — shows the autonomy level of the last action */}
          {dept.ringLevel != null && (
            <span style={{
              border: `1px solid ${RING_COLORS[dept.ringLevel]}`,
              borderRadius: 3,
              color: RING_COLORS[dept.ringLevel],
              fontSize: 9,
              letterSpacing: "0.06em",
              padding: "2px 5px",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}>
              R{dept.ringLevel} · {RING_LABELS[dept.ringLevel]}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
