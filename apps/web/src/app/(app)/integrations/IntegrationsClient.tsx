"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

// ---- Types ----

type IntegrationRow = {
  id: string;
  provider: string;
  status: "connected" | "revoked" | "error" | "pending";
  lastUsedAt: string | null;
  lastError: string | null;
};

type ConnectStatus = "idle" | "saving" | "success" | "error";

// ---- Integration definitions ----
// Each entry describes how to connect one provider.
// type: "oauth" = button redirects to OAuth flow
//       "token" = paste-in text field
//       "form"  = multiple fields

type OAuthIntegration = {
  type: "oauth";
  provider: string;
  label: string;
  description: string;
  oauthPath: string;
};

type TokenIntegration = {
  type: "token";
  provider: string;
  label: string;
  description: string;
  placeholder: string;
  apiPath: string;
  fieldName: string;
};

type FormIntegration = {
  type: "form";
  provider: string;
  label: string;
  description: string;
  fields: { name: string; label: string; placeholder: string; required: boolean }[];
  apiPath: string;
};

type IntegrationDef = OAuthIntegration | TokenIntegration | FormIntegration;

const INTEGRATIONS: IntegrationDef[] = [
  {
    type: "oauth",
    provider: "linkedin",
    label: "LinkedIn",
    description: "Post content, share company updates. Requires w_member_social scope.",
    oauthPath: "/api/v1/oauth/linkedin/authorize",
  },
  {
    type: "oauth",
    provider: "twitter",
    label: "Twitter / X",
    description: "Post tweets and threads. Requires tweet.write scope.",
    oauthPath: "/api/v1/oauth/twitter/authorize",
  },
  {
    type: "token",
    provider: "hubspot",
    label: "HubSpot",
    description: "Log outreach emails, update lead status, read CRM contacts.",
    placeholder: "pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    apiPath: "/hubspot",
    fieldName: "accessToken",
  },
  {
    type: "form",
    provider: "slack",
    label: "Slack",
    description: "Receive approval alerts and Ring 1 activity notifications.",
    apiPath: "/slack",
    fields: [
      { name: "botToken", label: "Bot Token", placeholder: "xoxb-...", required: true },
      { name: "channel", label: "Channel", placeholder: "#mammoth-updates", required: true },
    ],
  },
  {
    type: "form",
    provider: "github",
    label: "GitHub",
    description: "Auto-trigger PR reviews when pull requests are opened.",
    apiPath: "/github",
    fields: [
      { name: "accessToken", label: "Personal Access Token", placeholder: "ghp_...", required: true },
      { name: "owner", label: "Owner", placeholder: "myorg", required: true },
      { name: "repo", label: "Repository", placeholder: "my-repo", required: true },
    ],
  },
  {
    type: "token",
    provider: "apollo",
    label: "Apollo.io",
    description: "Real B2B lead research with verified contact data.",
    placeholder: "Apollo API key",
    apiPath: "/apollo",
    fieldName: "apiKey",
  },
  {
    type: "token",
    provider: "exa",
    label: "Exa AI Search",
    description: "Live web search for Research and Marketing agents.",
    placeholder: "Exa API key",
    apiPath: "/exa",
    fieldName: "apiKey",
  },
  {
    type: "form",
    provider: "vapi",
    label: "Vapi Voice",
    description: "AI-powered outbound voice calls for support callbacks.",
    apiPath: "/vapi",
    fields: [
      { name: "apiKey", label: "API Key", placeholder: "Vapi API key", required: true },
      { name: "phoneNumberId", label: "Phone Number ID", placeholder: "ph_...", required: true },
    ],
  },
  {
    type: "token",
    provider: "n8n",
    label: "N8N Webhook",
    description: "Fire outbound webhooks to N8N after each approved action executes.",
    placeholder: "https://your-n8n.com/webhook/...",
    apiPath: "/n8n",
    fieldName: "webhookUrl",
  },
];

// ---- Component ----

export function IntegrationsClient() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read ?connected=linkedin or ?error=... from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthError = params.get("error");
    if (connected) {
      setError(null);
      window.history.replaceState({}, "", "/integrations");
    }
    if (oauthError) {
      setError(`OAuth failed: ${oauthError}`);
      window.history.replaceState({}, "", "/integrations");
    }
  }, []);

  const loadData = useCallback(async () => {
    const companies = await api.get<{ id: string }[]>("/companies");
    const cId = companies[0]?.id;
    if (!cId) return;
    setCompanyId(cId);
    const data = await api.get<IntegrationRow[]>(`/companies/${cId}/integrations`);
    setRows(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadData().catch(() => setError("Failed to load integrations")).finally(() => setLoading(false));
  }, [loadData]);

  const statusFor = (provider: string): IntegrationRow["status"] | null =>
    rows.find((r) => r.provider === provider)?.status ?? null;

  async function disconnect(provider: string) {
    if (!companyId) return;
    await api.delete(`/companies/${companyId}/integrations/${provider}`);
    await loadData();
  }

  if (loading) return <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 8 }}>
      <h1 style={{ color: "var(--text)", fontSize: 18, fontWeight: 500, margin: "0 0 20px" }}>
        Integrations
      </h1>

      {error && (
        <div style={{ background: "var(--red-dim)", border: "1px solid var(--red)", borderRadius: 4, color: "var(--red)", fontSize: 12, marginBottom: 12, padding: "10px 14px" }}>
          {error}
        </div>
      )}

      {INTEGRATIONS.map((integration) => {
        const status = statusFor(integration.provider);
        const isConnected = status === "connected";
        return (
          <IntegrationCard
            key={integration.provider}
            integration={integration}
            isConnected={isConnected}
            companyId={companyId ?? ""}
            onConnect={loadData}
            onDisconnect={() => void disconnect(integration.provider)}
          />
        );
      })}
    </div>
  );
}

// ---- Integration Card ----

function IntegrationCard({
  integration,
  isConnected,
  companyId,
  onConnect,
  onDisconnect,
}: {
  integration: IntegrationDef;
  isConnected: boolean;
  companyId: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [connectError, setConnectError] = useState<string | null>(null);

  function handleOAuthConnect() {
    if (!companyId) return;
    const path = (integration as OAuthIntegration).oauthPath;
    window.location.href = `${path}?companyId=${companyId}`;
  }

  async function handleFormConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setConnectStatus("saving");
    setConnectError(null);
    try {
      const apiPath = (integration as TokenIntegration | FormIntegration).apiPath;
      await api.post(`/companies/${companyId}/integrations${apiPath}`, formValues);
      setConnectStatus("success");
      setExpanded(false);
      setFormValues({});
      await onConnect();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed");
      setConnectStatus("error");
    }
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${isConnected ? "var(--border)" : "var(--border)"}`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 12,
          justifyContent: "space-between",
          padding: "14px 20px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
              {integration.label}
            </span>
            {isConnected && (
              <span
                style={{
                  background: "var(--green-dim, rgba(34,197,94,0.15))",
                  border: "1px solid var(--green, #22c55e)",
                  borderRadius: 3,
                  color: "var(--green, #22c55e)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  padding: "1px 6px",
                  textTransform: "uppercase",
                }}
              >
                Connected
              </span>
            )}
          </div>
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
            {integration.description}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {isConnected ? (
            <button onClick={onDisconnect} style={ghostBtn}>
              Disconnect
            </button>
          ) : integration.type === "oauth" ? (
            <button onClick={handleOAuthConnect} style={primaryBtn(false)}>
              Connect with {integration.label.split(" ")[0]}
            </button>
          ) : (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={primaryBtn(false)}
            >
              {expanded ? "Cancel" : "Connect"}
            </button>
          )}
        </div>
      </div>

      {/* Expandable form for token/form type integrations */}
      {expanded && !isConnected && integration.type !== "oauth" && (
        <form
          onSubmit={(e) => void handleFormConnect(e)}
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 20px 16px",
          }}
        >
          {integration.type === "token" ? (
            <input
              value={formValues[integration.fieldName] ?? ""}
              onChange={(e) =>
                setFormValues({ ...formValues, [integration.fieldName]: e.target.value })
              }
              placeholder={integration.placeholder}
              required
              style={inputStyle}
            />
          ) : (
            integration.fields.map((field) => (
              <div key={field.name}>
                <label style={{ color: "var(--text-muted)", display: "block", fontSize: 11, marginBottom: 4 }}>
                  {field.label}
                </label>
                <input
                  value={formValues[field.name] ?? ""}
                  onChange={(e) =>
                    setFormValues({ ...formValues, [field.name]: e.target.value })
                  }
                  placeholder={field.placeholder}
                  required={field.required}
                  style={inputStyle}
                />
              </div>
            ))
          )}

          {connectError && (
            <p style={{ color: "var(--red)", fontSize: 11, margin: 0 }}>{connectError}</p>
          )}

          <button
            type="submit"
            disabled={connectStatus === "saving"}
            style={{ ...primaryBtn(connectStatus === "saving"), alignSelf: "flex-start" }}
          >
            {connectStatus === "saving" ? "Saving..." : "Save"}
          </button>
        </form>
      )}
    </div>
  );
}

// ---- Shared styles ----

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
  boxSizing: "border-box",
};

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "6px 12px",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "var(--surface-2)" : "var(--text)",
    border: "none",
    borderRadius: 4,
    color: disabled ? "var(--text-muted)" : "var(--bg)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 500,
    padding: "7px 14px",
    whiteSpace: "nowrap",
  };
}
