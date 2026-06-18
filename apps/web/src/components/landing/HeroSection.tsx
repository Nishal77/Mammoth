import Link from "next/link";

export function HeroSection() {
  return (
    <section
      style={{
        padding: "160px 24px 100px",
        maxWidth: 1100,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      {/* Status pill */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 14px",
          border: "1px solid var(--border)",
          borderRadius: 100,
          marginBottom: 40,
          fontSize: 11,
          color: "var(--text-muted)",
          letterSpacing: "0.06em",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "var(--green)",
            display: "inline-block",
          }}
        />
        Now in private beta
      </div>

      {/* Headline */}
      <h1
        style={{
          fontSize: "clamp(36px, 6vw, 64px)",
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          margin: "0 0 24px",
          color: "var(--text)",
        }}
      >
        One goal.
        <br />
        Nine departments.
        <br />
        <span style={{ color: "var(--text-muted)" }}>All autonomous.</span>
      </h1>

      {/* Subheading */}
      <p
        style={{
          fontSize: 15,
          color: "var(--text-muted)",
          maxWidth: 520,
          margin: "0 auto 48px",
          lineHeight: 1.7,
        }}
      >
        Set a revenue target. MAMMOTH deploys nine AI departments — Marketing,
        Sales, Engineering, Finance, and five more — that work around the clock
        to hit it.
      </p>

      {/* CTAs */}
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
            padding: "12px 28px",
            backgroundColor: "var(--text)",
            color: "var(--bg)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
            borderRadius: 4,
          }}
        >
          Start free
        </Link>
        <Link
          href="#how-it-works"
          style={{
            padding: "12px 28px",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: 13,
            letterSpacing: "0.04em",
            borderRadius: 4,
          }}
        >
          See how it works
        </Link>
      </div>

      {/* Terminal mockup */}
      <div
        style={{
          marginTop: 80,
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          textAlign: "left",
          backgroundColor: "var(--surface)",
        }}
      >
        {/* Window chrome */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={dotStyle("#ef4444")} />
          <span style={dotStyle("#eab308")} />
          <span style={dotStyle("#22c55e")} />
          <span
            style={{
              marginLeft: 12,
              fontSize: 11,
              color: "var(--text-subtle)",
              letterSpacing: "0.06em",
            }}
          >
            mammoth — agent activity
          </span>
        </div>

        {/* Log lines */}
        <div style={{ padding: "16px 20px", fontSize: 12, lineHeight: 1.9 }}>
          <LogLine prefix="ceo" color="var(--blue)" text="Goal decomposed → 9 department OKRs created" />
          <LogLine prefix="marketing" color="var(--green)" text="Campaign drafted: &quot;Q3 SaaS Growth&quot; — sent for Ring 2 approval" />
          <LogLine prefix="sales" color="var(--green)" text="42 leads researched, outreach sequences queued" />
          <LogLine prefix="engineering" color="var(--yellow)" text="Sprint planned: 8 issues triaged, 3 PRs reviewed" />
          <LogLine prefix="content" color="var(--green)" text="Blog post published: &quot;How we hit $100k MRR&quot;" />
          <LogLine prefix="finance" color="var(--text-muted)" text="MRR report generated: $94,200 → on track" />
          <LogLine prefix="research" color="var(--green)" text="Competitor intel updated: 2 threats identified" />
          <LogLine
            prefix="support"
            color="var(--green)"
            text="14 tickets resolved, KB article created"
          />
          <LogLine prefix="hr" color="var(--text-muted)" text="3 JDs posted, 12 candidates screened" />
          <div
            style={{ marginTop: 4, color: "var(--text-subtle)", fontSize: 11 }}
          >
            <span style={{ color: "var(--green)" }}>▶</span> next cycle in 5h
            42m — all systems nominal
          </div>
        </div>
      </div>
    </section>
  );
}

function dotStyle(color: string): React.CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: "50%",
    backgroundColor: color,
    display: "inline-block",
    opacity: 0.8,
  };
}

function LogLine({
  prefix,
  color,
  text,
}: {
  prefix: string;
  color: string;
  text: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: "var(--text-subtle)", minWidth: 14 }}>›</span>
      <span style={{ color, minWidth: 96, flexShrink: 0 }}>[{prefix}]</span>
      <span style={{ color: "var(--text-muted)" }}>{text}</span>
    </div>
  );
}
