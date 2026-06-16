"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Step = "company_details" | "brand_voice" | "first_goal" | "connect";

type SessionData = {
  sessionId: string;
  nextStep: string;
};

const STEPS: { key: Step; label: string }[] = [
  { key: "company_details", label: "Company" },
  { key: "brand_voice", label: "Brand Voice" },
  { key: "first_goal", label: "Goal" },
  { key: "connect", label: "Connect" },
];

export function OnboardingClient() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step fields
  const [tagline, setTagline] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState("early-revenue");
  const [brandVoice, setBrandVoice] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalUnit, setGoalUnit] = useState("USD");
  const [goalDeadline, setGoalDeadline] = useState("");

  async function startSession() {
    if (!companyName.trim()) return;
    setIsPending(true);
    setError(null);
    try {
      const data = await api.post<SessionData>("/onboarding/start", { companyName });
      setSessionId(data.sessionId);
      setStep("company_details");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setIsPending(false);
    }
  }

  async function submitStep(stepKey: Step, body: Record<string, unknown>) {
    if (!sessionId) return;
    setIsPending(true);
    setError(null);
    try {
      const data = await api.patch<SessionData>(`/onboarding/${sessionId}/step`, {
        step: stepKey,
        ...body,
      });
      const next = data.nextStep as Step;
      setStep(next === "complete" ? "connect" : next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save step");
    } finally {
      setIsPending(false);
    }
  }

  async function complete() {
    if (!sessionId) return;
    setIsPending(true);
    setError(null);
    try {
      await api.post(`/onboarding/${sessionId}/complete`, {});
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding");
    } finally {
      setIsPending(false);
    }
  }

  const currentStepIndex = step ? STEPS.findIndex((s) => s.key === step) : -1;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        justifyContent: "center",
        padding: "60px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        {/* Logo */}
        <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 40 }}>
          MAMMOTH
        </p>

        {/* Step indicator */}
        {step && (
          <div style={{ display: "flex", gap: 4, marginBottom: 32 }}>
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                style={{
                  flex: 1,
                  height: 2,
                  borderRadius: 1,
                  background: i <= currentStepIndex ? "var(--text)" : "var(--border)",
                  transition: "background 0.2s",
                }}
              />
            ))}
          </div>
        )}

        {/* Start */}
        {!step && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h1 style={{ color: "var(--text)", fontSize: 20, fontWeight: 500, margin: "0 0 6px" }}>
                Set up your company
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                MAMMOTH deploys 9 AI departments to hit your revenue goal.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>Company name</label>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc."
                onKeyDown={(e) => e.key === "Enter" && void startSession()}
                style={inputStyle}
              />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{error}</p>}
            <button
              onClick={() => void startSession()}
              disabled={isPending || !companyName.trim()}
              style={primaryBtn(isPending)}
            >
              {isPending ? "Starting..." : "Get started"}
            </button>
          </div>
        )}

        {/* Company details */}
        {step === "company_details" && (
          <StepForm
            title="About your company"
            subtitle="Help the agents understand the context."
            onSubmit={() => void submitStep("company_details", { tagline, industry, stage })}
            isPending={isPending}
            error={error}
          >
            <Field label="Tagline">
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="The AI platform for X" style={inputStyle} />
            </Field>
            <Field label="Industry">
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="SaaS / Fintech / ..." style={inputStyle} />
            </Field>
            <Field label="Stage">
              <select value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
                <option value="idea">Idea</option>
                <option value="pre-revenue">Pre-revenue</option>
                <option value="early-revenue">Early revenue</option>
                <option value="growing">Growing</option>
                <option value="scaling">Scaling</option>
              </select>
            </Field>
          </StepForm>
        )}

        {/* Brand voice */}
        {step === "brand_voice" && (
          <StepForm
            title="Brand voice"
            subtitle="How does your company communicate? Write a few sentences that capture your tone."
            onSubmit={() => void submitStep("brand_voice", { brandVoice })}
            isPending={isPending}
            error={error}
          >
            <textarea
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              placeholder="We are direct, technical, and never use corporate jargon. We write like engineers talking to engineers..."
              rows={6}
              required
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </StepForm>
        )}

        {/* First goal */}
        {step === "first_goal" && (
          <StepForm
            title="Revenue goal"
            subtitle="One goal. All 9 departments will pursue it."
            onSubmit={() => void submitStep("first_goal", {
              title: goalTitle,
              type: "revenue",
              targetValue: goalTarget,
              unit: goalUnit,
              deadline: goalDeadline,
            })}
            isPending={isPending}
            error={error}
          >
            <Field label="Goal title">
              <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} required placeholder="Reach $1M ARR" style={inputStyle} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Target">
                <input value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} required placeholder="1000000" style={inputStyle} />
              </Field>
              <Field label="Unit">
                <input value={goalUnit} onChange={(e) => setGoalUnit(e.target.value)} required placeholder="USD" style={inputStyle} />
              </Field>
            </div>
            <Field label="Deadline">
              <input type="date" value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} required style={inputStyle} />
            </Field>
          </StepForm>
        )}

        {/* Connect notifications */}
        {step === "connect" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 500, margin: "0 0 6px" }}>
                Connect notifications
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                Agents will send approval requests and briefings to your phone.
                You can also do this later in Settings.
              </p>
            </div>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <p style={{ color: "var(--text)", fontSize: 13, margin: 0, fontWeight: 500 }}>Telegram (recommended)</p>
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
                Inline approve/reject buttons. No typing needed for quick decisions.
              </p>
              <a
                href="/settings"
                style={{ color: "var(--blue)", fontSize: 12, textDecoration: "none", marginTop: 4 }}
              >
                Set up in Settings →
              </a>
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{error}</p>}
            <button
              onClick={() => void complete()}
              disabled={isPending}
              style={primaryBtn(isPending)}
            >
              {isPending ? "Launching..." : "Launch MAMMOTH"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepForm({
  title,
  subtitle,
  children,
  onSubmit,
  isPending,
  error,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onSubmit: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 500, margin: "0 0 6px" }}>{title}</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
      {error && <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{error}</p>}
      <button onClick={onSubmit} disabled={isPending} style={primaryBtn(isPending)}>
        {isPending ? "Saving..." : "Continue"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 11,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 13,
  outline: "none",
  padding: "9px 12px",
  width: "100%",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "var(--surface-2)" : "var(--text)",
    border: "none",
    borderRadius: 4,
    color: disabled ? "var(--text-muted)" : "var(--bg)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 500,
    padding: "11px 20px",
    width: "100%",
  };
}
