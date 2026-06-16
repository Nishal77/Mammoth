"use client";

type MetricSummary = {
  mrr: string | null;
  totalRevenue: string | null;
  totalLeads: number;
  totalCustomers: number;
  totalTasks: number;
};

export function MetricStrip({ metrics }: { metrics: MetricSummary }) {
  const items = [
    { label: "MRR", value: metrics.mrr ? `$${Number(metrics.mrr).toLocaleString()}` : "—" },
    { label: "Revenue", value: metrics.totalRevenue ? `$${Number(metrics.totalRevenue).toLocaleString()}` : "—" },
    { label: "Leads", value: metrics.totalLeads.toLocaleString() },
    { label: "Customers", value: metrics.totalCustomers.toLocaleString() },
    { label: "Tasks run", value: metrics.totalTasks.toLocaleString() },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 1,
        background: "var(--border)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {items.map(({ label, value }) => (
        <div
          key={label}
          style={{
            background: "var(--surface)",
            padding: "16px 20px",
          }}
        >
          <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "0 0 6px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {label}
          </p>
          <p style={{ color: "var(--text)", fontSize: 18, fontWeight: 500, margin: 0, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
