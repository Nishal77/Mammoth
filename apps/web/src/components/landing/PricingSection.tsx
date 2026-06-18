import Link from "next/link";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try MAMMOTH with one department.",
    cta: "Start free",
    ctaHref: "/signup",
    highlighted: false,
    limits: [
      "1 active department",
      "5 tasks per day",
      "$0.50/day AI budget",
      "Ring 2 approvals",
      "Community support",
    ],
  },
  {
    name: "Growth",
    price: "$99",
    period: "per month",
    description: "Five departments working in parallel.",
    cta: "Start trial",
    ctaHref: "/signup?plan=growth",
    highlighted: true,
    limits: [
      "5 active departments",
      "50 tasks per day",
      "$5/day AI budget",
      "All three rings",
      "Email support",
    ],
  },
  {
    name: "Scale",
    price: "$299",
    period: "per month",
    description: "All nine departments, no daily limits.",
    cta: "Start trial",
    ctaHref: "/signup?plan=scale",
    highlighted: false,
    limits: [
      "All 9 departments",
      "500 tasks per day",
      "$50/day AI budget",
      "Progressive Trust Engine",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "Unlimited usage, dedicated infrastructure.",
    cta: "Contact us",
    ctaHref: "mailto:sales@mammoth.ai",
    highlighted: false,
    limits: [
      "All 9 departments",
      "Unlimited tasks",
      "Custom AI budget",
      "SSO + audit log",
      "Dedicated onboarding",
    ],
  },
] as const;

export function PricingSection() {
  return (
    <section
      id="pricing"
      style={{
        padding: "100px 24px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 64, maxWidth: 480 }}>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-subtle)",
              letterSpacing: "0.12em",
              marginBottom: 16,
            }}
          >
            PRICING
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
            Start with one department.
            <br />
            Scale to all nine.
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7 }}>
            No per-seat pricing. One flat rate per company, regardless of team size.
          </p>
        </div>

        {/* Plans grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              style={{
                padding: "28px",
                border: plan.highlighted
                  ? "1px solid var(--text)"
                  : "1px solid var(--border)",
                borderRadius: 8,
                backgroundColor: plan.highlighted ? "var(--surface)" : "var(--bg)",
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              {plan.highlighted && (
                <div
                  style={{
                    position: "absolute",
                    top: -1,
                    left: 24,
                    right: 24,
                    height: 2,
                    backgroundColor: "var(--text)",
                  }}
                />
              )}

              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: plan.highlighted ? "var(--text)" : "var(--text-muted)",
                  letterSpacing: "0.1em",
                  margin: "0 0 20px",
                }}
              >
                {plan.name.toUpperCase()}
              </p>

              <div style={{ marginBottom: 8 }}>
                <span
                  style={{
                    fontSize: 36,
                    fontWeight: 700,
                    color: "var(--text)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {plan.price}
                </span>
                {plan.period && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginLeft: 4,
                    }}
                  >
                    /{plan.period}
                  </span>
                )}
              </div>

              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  margin: "0 0 24px",
                  lineHeight: 1.6,
                }}
              >
                {plan.description}
              </p>

              {/* Feature list */}
              <ul
                style={{
                  margin: "0 0 28px",
                  padding: 0,
                  listStyle: "none",
                  flexGrow: 1,
                }}
              >
                {plan.limits.map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      display: "flex",
                      gap: 8,
                      marginBottom: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    <span style={{ color: "var(--green)", flexShrink: 0 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                style={{
                  display: "block",
                  padding: "10px 0",
                  textAlign: "center",
                  textDecoration: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  borderRadius: 4,
                  backgroundColor: plan.highlighted ? "var(--text)" : "transparent",
                  color: plan.highlighted ? "var(--bg)" : "var(--text-muted)",
                  border: plan.highlighted
                    ? "1px solid var(--text)"
                    : "1px solid var(--border)",
                }}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
