const RINGS = [
  {
    level: 1,
    name: "Ring 1 — Executes automatically",
    color: "var(--ring-1)",
    badge: "No notification",
    description:
      "Routine, low-risk actions your company has approved many times before. The agent runs them silently. You never see them unless you go looking.",
    examples: [
      "Publish a blog post matching brand guidelines",
      "Add a qualified lead to an existing sequence",
      "Update the knowledge base with a resolved ticket",
    ],
  },
  {
    level: 2,
    name: "Ring 2 — 4-hour veto window",
    color: "var(--ring-2)",
    badge: "Notifies founder",
    description:
      "Actions that involve new spend, outbound communication, or anything that touches your brand publicly. You get a notification and 4 hours to veto.",
    examples: [
      "Launch a new ad campaign with a budget",
      "Send a cold outreach sequence to a new audience",
      "Post on social media for the first time in a category",
    ],
  },
  {
    level: 3,
    name: "Ring 3 — Explicit approval required",
    color: "var(--ring-3)",
    badge: "Hard gate",
    description:
      "High-stakes, irreversible, or high-cost actions. Nothing happens until you click approve. No auto-execution, no veto window — just a hard stop.",
    examples: [
      "Commit to a paid annual contract",
      "Hire a contractor or make a job offer",
      "Deploy a code change that touches billing or auth",
    ],
  },
] as const;

export function RingsSection() {
  return (
    <section
      id="how-it-works"
      style={{
        padding: "100px 24px",
        borderTop: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 64, maxWidth: 560 }}>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-subtle)",
              letterSpacing: "0.12em",
              marginBottom: 16,
            }}
          >
            THREE RINGS OF AUTONOMY
          </p>
          <h2
            style={{
              fontSize: "clamp(24px, 4vw, 40px)",
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
            }}
          >
            You control how much the agents do.
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7 }}>
            MAMMOTH never goes rogue. Every action sits in one of three rings.
            As the AI earns trust through repeated approvals, low-risk actions
            graduate to Ring 1 and stop interrupting you.
          </p>
        </div>

        {/* Rings */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {RINGS.map((ring) => (
            <div
              key={ring.level}
              style={{
                padding: "28px",
                border: `1px solid var(--border)`,
                borderTop: `3px solid ${ring.color}`,
                borderRadius: 8,
                backgroundColor: "var(--bg)",
              }}
            >
              {/* Badge row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: `2px solid ${ring.color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: ring.color,
                    flexShrink: 0,
                  }}
                >
                  {ring.level}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: ring.color,
                    letterSpacing: "0.08em",
                    padding: "2px 8px",
                    border: `1px solid ${ring.color}`,
                    borderRadius: 100,
                    opacity: 0.9,
                  }}
                >
                  {ring.badge}
                </span>
              </div>

              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  margin: "0 0 10px",
                }}
              >
                {ring.name}
              </p>

              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  lineHeight: 1.7,
                  margin: "0 0 20px",
                }}
              >
                {ring.description}
              </p>

              {/* Examples */}
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {ring.examples.map((ex) => (
                  <li
                    key={ex}
                    style={{
                      fontSize: 11,
                      color: "var(--text-subtle)",
                      lineHeight: 1.6,
                      display: "flex",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ color: ring.color, flexShrink: 0 }}>›</span>
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Trust engine callout */}
        <div
          style={{
            marginTop: 40,
            padding: "20px 24px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            backgroundColor: "var(--surface)",
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
          }}
        >
          <span
            style={{
              fontSize: 16,
              flexShrink: 0,
              color: "var(--green)",
              marginTop: 1,
            }}
          >
            ↑
          </span>
          <div>
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text)",
                margin: "0 0 4px",
              }}
            >
              Progressive Trust Engine
            </p>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                margin: 0,
                lineHeight: 1.7,
              }}
            >
              After 10 consecutive unmodified approvals for a specific action type,
              that action graduates from Ring 2 to Ring 1 automatically. Trust is
              earned per action type, per department, per company. Any modification
              resets the counter immediately.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
