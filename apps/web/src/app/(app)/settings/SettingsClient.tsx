"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

type TelegramStatus = { connected: boolean };
type TelegramConnectData = {
  botLink: string;
  token: string;
  expiresInSeconds: number;
  instructions: string;
};

export function SettingsClient() {
  const { data: session } = useSession();
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [connectData, setConnectData] = useState<TelegramConnectData | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [waStatus, setWaStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [telegramStatus2, setTelegramStatus2] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<TelegramStatus>("/users/me/notifications/telegram-status")
      .then(setTelegramStatus)
      .catch(() => null);
  }, []);

  async function generateTelegramLink() {
    setTelegramStatus2("loading");
    setError(null);
    try {
      const data = await api.get<TelegramConnectData>("/users/me/notifications/telegram-connect");
      setConnectData(data);
      setTelegramStatus2("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate link");
      setTelegramStatus2("idle");
    }
  }

  async function disconnectTelegram() {
    await api.delete("/users/me/notifications/telegram-connect");
    setTelegramStatus({ connected: false });
    setConnectData(null);
  }

  async function connectWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    if (!whatsappPhone.match(/^\+[1-9]\d{6,14}$/)) {
      setError("Enter phone in E.164 format, e.g. +14155551234");
      return;
    }
    setWaStatus("saving");
    setError(null);
    try {
      await api.post("/users/me/notifications/whatsapp-connect", { phone: whatsappPhone });
      setWaStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setWaStatus("error");
    }
  }

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 32 }}>
      <h1 style={{ color: "var(--text)", fontSize: 18, fontWeight: 500, margin: 0 }}>Settings</h1>

      {/* Account */}
      <Section title="Account">
        <Row label="Email">{session?.user?.email ?? "—"}</Row>
        <Row label="Name">{session?.user?.name ?? "—"}</Row>
      </Section>

      {/* Telegram */}
      <Section title="Telegram">
        <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 16px" }}>
          Primary notification channel. Receive approvals, veto alerts, and morning briefings.
          Act directly from Telegram with inline buttons.
        </p>

        {telegramStatus?.connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--green)", fontSize: 12 }}>Connected</span>
            <button
              onClick={() => void disconnectTelegram()}
              style={ghostBtnStyle}
            >
              Disconnect
            </button>
          </div>
        ) : connectData ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>{connectData.instructions}</p>
            <a
              href={connectData.botLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--blue)",
                display: "inline-block",
                fontSize: 12,
                padding: "8px 14px",
                textDecoration: "none",
                wordBreak: "break-all",
              }}
            >
              {connectData.botLink}
            </a>
            <p style={{ color: "var(--text-subtle)", fontSize: 11, margin: 0 }}>
              Link expires in {connectData.expiresInSeconds / 60} minutes
            </p>
          </div>
        ) : (
          <button
            onClick={() => void generateTelegramLink()}
            disabled={telegramStatus2 === "loading"}
            style={primaryBtnStyle(telegramStatus2 === "loading")}
          >
            {telegramStatus2 === "loading" ? "Generating..." : "Connect Telegram"}
          </button>
        )}
      </Section>

      {/* WhatsApp */}
      <Section title="WhatsApp">
        <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 16px" }}>
          Secondary channel. Same notifications as Telegram. Use keyword replies: APPROVE / REJECT.
        </p>

        <form onSubmit={(e) => void connectWhatsApp(e)} style={{ display: "flex", gap: 10 }}>
          <input
            value={whatsappPhone}
            onChange={(e) => setWhatsappPhone(e.target.value)}
            placeholder="+14155551234"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="submit"
            disabled={waStatus === "saving"}
            style={primaryBtnStyle(waStatus === "saving")}
          >
            {waStatus === "saving" ? "Saving..." : waStatus === "saved" ? "Saved" : "Connect"}
          </button>
        </form>
      </Section>

      {error && (
        <p style={{ color: "var(--red)", fontSize: 12, margin: 0 }}>{error}</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      <h3 style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, margin: "0 0 16px" }}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid var(--border-muted)",
      }}
    >
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</span>
      <span style={{ color: "var(--text)", fontSize: 12 }}>{children}</span>
    </div>
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
};

const ghostBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "6px 12px",
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "var(--surface-2)" : "var(--text)",
    border: "none",
    borderRadius: 4,
    color: disabled ? "var(--text-muted)" : "var(--bg)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 500,
    padding: "8px 16px",
    whiteSpace: "nowrap" as const,
  };
}
