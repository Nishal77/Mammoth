const DEPARTMENTS = [
  {
    name: "CEO Brain",
    cadence: "Every 6h",
    description: "Decomposes the revenue goal into OKRs, detects pivots, and sets weekly targets for all departments.",
    color: "var(--blue)",
  },
  {
    name: "Marketing",
    cadence: "Continuous",
    description: "Runs campaigns, targets audiences, distributes content across channels.",
    color: "var(--green)",
  },
  {
    name: "Sales",
    cadence: "Continuous",
    description: "Researches leads, builds outreach sequences, and operates the CRM.",
    color: "var(--green)",
  },
  {
    name: "Engineering",
    cadence: "Daily",
    description: "Plans sprints, reviews PRs, triages issues. Cannot push to main by architecture.",
    color: "var(--yellow)",
  },
  {
    name: "Support",
    cadence: "Continuous",
    description: "Resolves tickets and maintains the knowledge base so the same issue never recurs.",
    color: "var(--green)",
  },
  {
    name: "Finance",
    cadence: "Daily",
    description: "Read-only reporting on MRR, burn, and runway. Has zero write access by design.",
    color: "var(--text-muted)",
  },
  {
    name: "Research",
    cadence: "Weekly",
    description: "Monitors competitors, surfaces market threats, and reports trend intelligence.",
    color: "var(--blue)",
  },
  {
    name: "HR",
    cadence: "On demand",
    description: "Writes job descriptions, screens candidates, and manages the hiring pipeline.",
    color: "var(--text-muted)",
  },
  {
    name: "Content",
    cadence: "Daily",
    description: "Produces blog posts, social copy, and SEO content aligned to the revenue goal.",
    color: "var(--green)",
  },
] as const;

export function DepartmentsSection() {
  return (
    <section
      id="features"
      style={{
        padding: "100px 24px",
        borderTop: "1px solid var(--border)",
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
            THE 9 DEPARTMENTS
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
            A full company, running 24/7.
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7 }}>
            Each department is an autonomous AI agent with its own tools, memory,
            and cadence. They share context and hand off work without you in the loop.
          </p>
        </div>

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 1,
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {DEPARTMENTS.map((dept) => (
            <div
              key={dept.name}
              style={{
                padding: "24px",
                backgroundColor: "var(--surface)",
                borderRight: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  {dept.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: dept.color,
                    letterSpacing: "0.06em",
                    padding: "2px 8px",
                    border: `1px solid ${dept.color}`,
                    borderRadius: 100,
                    opacity: 0.8,
                  }}
                >
                  {dept.cadence}
                </span>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                {dept.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
