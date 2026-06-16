"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GoalCard } from "@/components/GoalCard";

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

type NewGoalForm = {
  title: string;
  type: "revenue" | "users" | "other";
  targetValue: string;
  unit: string;
  deadline: string;
};

export function GoalsClient() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<NewGoalForm>({
    title: "",
    type: "revenue",
    targetValue: "",
    unit: "USD",
    deadline: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const companies = await api.get<{ id: string }[]>("/companies");
        const cId = companies[0]?.id;
        if (!cId) return;
        setCompanyId(cId);
        const rows = await api.get<Goal[]>(`/companies/${cId}/goals`);
        setGoals(rows);
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || isSaving) return;
    setError(null);
    setIsSaving(true);
    try {
      await api.post(`/companies/${companyId}/goals`, form);
      const rows = await api.get<Goal[]>(`/companies/${companyId}/goals`);
      setGoals(rows);
      setIsCreating(false);
      setForm({ title: "", type: "revenue", targetValue: "", unit: "USD", deadline: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create goal");
    } finally {
      setIsSaving(false);
    }
  }

  const activeGoals = goals.filter((g) => g.status === "active");
  const pastGoals = goals.filter((g) => g.status !== "active");

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 700, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ color: "var(--text)", fontSize: 18, fontWeight: 500, margin: 0 }}>Goals</h1>
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            style={{
              background: "var(--text)",
              border: "none",
              borderRadius: 4,
              color: "var(--bg)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 500,
              padding: "7px 14px",
            }}
          >
            New goal
          </button>
        )}
      </div>

      {isCreating && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "20px 24px",
          }}
        >
          <h3 style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, margin: 0 }}>New goal</h3>

          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              placeholder="Reach $1M ARR"
              style={inputStyle}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Type">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as NewGoalForm["type"] }))}
                style={inputStyle}
              >
                <option value="revenue">Revenue</option>
                <option value="users">Users</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Unit">
              <input
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                required
                placeholder="USD / users / ..."
                style={inputStyle}
              />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Target value">
              <input
                value={form.targetValue}
                onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value }))}
                required
                pattern="^\d+(\.\d{1,2})?$"
                placeholder="1000000"
                style={inputStyle}
              />
            </Field>
            <Field label="Deadline">
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                required
                style={inputStyle}
              />
            </Field>
          </div>

          {error && <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                background: isSaving ? "var(--surface-2)" : "var(--text)",
                border: "none",
                borderRadius: 4,
                color: isSaving ? "var(--text-muted)" : "var(--bg)",
                cursor: isSaving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 500,
                padding: "8px 16px",
              }}
            >
              {isSaving ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                padding: "8px 16px",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {activeGoals.length > 0 && (
        <section>
          <SectionHeader>Active</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {activeGoals.map((g) => <GoalCard key={g.id} goal={g} />)}
          </div>
        </section>
      )}

      {pastGoals.length > 0 && (
        <section>
          <SectionHeader>History</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pastGoals.map((g) => (
              <div
                key={g.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                }}
              >
                <div>
                  <p style={{ color: "var(--text)", fontSize: 13, margin: 0 }}>{g.title}</p>
                  <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "4px 0 0" }}>
                    {g.currentValue}/{g.targetValue} {g.unit}
                  </p>
                </div>
                <span style={{ color: "var(--text-subtle)", fontSize: 12, textTransform: "capitalize", alignSelf: "center" }}>
                  {g.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {goals.length === 0 && !isCreating && (
        <p style={{ color: "var(--text-subtle)", fontSize: 13 }}>No goals yet.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 400, letterSpacing: "0.1em", margin: "0 0 12px", textTransform: "uppercase" }}>
      {children}
    </h2>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 12,
  outline: "none",
  padding: "8px 12px",
  width: "100%",
};
