"use client";

type Goal = {
  id: string;
  title: string;
  type: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  deadline: string;
  status: string;
};

export function GoalCard({ goal }: { goal: Goal }) {
  const current = Number(goal.currentValue);
  const target = Number(goal.targetValue);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  const daysLeft = Math.ceil(
    (new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "0 0 4px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Active Goal
          </p>
          <h3 style={{ color: "var(--text)", fontSize: 15, fontWeight: 500, margin: 0 }}>
            {goal.title}
          </h3>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "0 0 4px" }}>Deadline</p>
          <p style={{ color: daysLeft < 14 ? "var(--yellow)" : "var(--text)", fontSize: 13, margin: 0 }}>
            {daysLeft > 0 ? `${daysLeft}d left` : "Overdue"}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 2, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: pct >= 100 ? "var(--green)" : pct >= 50 ? "var(--blue)" : "var(--text-muted)",
              borderRadius: 2,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {Number(goal.currentValue).toLocaleString()} / {Number(goal.targetValue).toLocaleString()} {goal.unit}
        </span>
        <span style={{ color: pct >= 100 ? "var(--green)" : "var(--text)", fontSize: 12, fontWeight: 500 }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}
