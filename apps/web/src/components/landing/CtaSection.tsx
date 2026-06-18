import Link from "next/link";

export function CtaSection() {
  return (
    <section
      style={{
        padding: "120px 24px",
        borderTop: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <p
          style={{
            fontSize: 11,
            color: "var(--text-subtle)",
            letterSpacing: "0.12em",
            marginBottom: 24,
          }}
        >
          READY TO SHIP
        </p>

        <h2
          style={{
            fontSize: "clamp(28px, 5vw, 52px)",
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            margin: "0 0 20px",
          }}
        >
          Set one goal.
          <br />
          <span style={{ color: "var(--text-muted)" }}>
            Let nine agents chase it.
          </span>
        </h2>

        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            lineHeight: 1.7,
            marginBottom: 48,
          }}
        >
          No sales call. No annual contract. Start with the free plan,
          add departments as you need them.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/signup"
            style={{
              padding: "13px 32px",
              backgroundColor: "var(--text)",
              color: "var(--bg)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.04em",
              borderRadius: 4,
            }}
          >
            Start free — no card required
          </Link>
        </div>

        <p
          style={{
            marginTop: 24,
            fontSize: 11,
            color: "var(--text-subtle)",
          }}
        >
          Free tier includes 1 department, 5 tasks/day, forever.
        </p>
      </div>
    </section>
  );
}
