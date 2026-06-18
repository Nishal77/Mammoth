const METRICS = [
  { value: "9", label: "Autonomous departments" },
  { value: "24/7", label: "Agent uptime" },
  { value: "6h", label: "CEO Brain cycle" },
  { value: "3", label: "Rings of autonomy" },
  { value: "$0", label: "Human headcount required" },
  { value: "1", label: "Goal to set" },
] as const;

export function MetricsSection() {
  return (
    <section
      style={{
        padding: "80px 24px",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 1,
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {METRICS.map((m) => (
          <div
            key={m.label}
            style={{
              padding: "32px 24px",
              backgroundColor: "var(--surface)",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                fontWeight: 700,
                color: "var(--text)",
                margin: "0 0 6px",
                letterSpacing: "-0.02em",
              }}
            >
              {m.value}
            </p>
            <p
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                margin: 0,
                letterSpacing: "0.04em",
              }}
            >
              {m.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
