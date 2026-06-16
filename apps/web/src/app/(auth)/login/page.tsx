"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      await signIn.email({ email, password });
      router.push(callbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div style={{ width: 360 }}>
        <div style={{ marginBottom: 40 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            MAMMOTH
          </p>
          <h1 style={{ color: "var(--text)", fontSize: 18, fontWeight: 500, margin: "8px 0 0" }}>
            Sign in
          </h1>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
              style={inputStyle}
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              style={inputStyle}
            />
          </Field>

          {error && (
            <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            style={buttonStyle(isPending)}
          >
            {isPending ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p style={{ marginTop: 24, color: "var(--text-muted)", fontSize: 12 }}>
          No account?{" "}
          <a href="/signup" style={{ color: "var(--text)", textDecoration: "none" }}>
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 13,
  padding: "8px 12px",
  outline: "none",
  width: "100%",
};

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "var(--surface-2)" : "var(--text)",
    border: "none",
    borderRadius: 4,
    color: disabled ? "var(--text-muted)" : "var(--bg)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 500,
    marginTop: 8,
    padding: "10px 16px",
    width: "100%",
  };
}
