"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const MEMORY_TYPES = ["identity", "brand", "customer", "competitor", "decision_log"] as const;
type MemoryType = typeof MEMORY_TYPES[number];

type MemoryRecord = {
  id: string;
  memoryType: MemoryType;
  key: string;
  value: string;
  updatedAt: string;
};

export function MemoryClient() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [memoryByType, setMemoryByType] = useState<Record<MemoryType, MemoryRecord[]>>({
    identity: [],
    brand: [],
    customer: [],
    competitor: [],
    decision_log: [],
  });
  const [activeType, setActiveType] = useState<MemoryType>("identity");
  const [isLoading, setIsLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadMemory = useCallback(async (cId: string) => {
    const rows = await api.get<MemoryRecord[]>(`/companies/${cId}/memory`);
    const grouped: Record<MemoryType, MemoryRecord[]> = {
      identity: [],
      brand: [],
      customer: [],
      competitor: [],
      decision_log: [],
    };
    for (const row of rows) {
      const bucket = grouped[row.memoryType];
      if (bucket) bucket.push(row);
    }
    setMemoryByType(grouped);
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const companies = await api.get<{ id: string }[]>("/companies");
        const cId = companies[0]?.id;
        if (!cId) return;
        setCompanyId(cId);
        await loadMemory(cId);
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [loadMemory]);

  async function saveEdit() {
    if (!editing || !companyId || !editValue.trim()) return;
    setIsSaving(true);
    try {
      await api.patch(`/companies/${companyId}/memory/${editing.id}`, {
        value: editValue,
      });
      await loadMemory(companyId);
      setEditing(null);
    } finally {
      setIsSaving(false);
    }
  }

  const activeRows = memoryByType[activeType];
  const filtered = searchQ
    ? activeRows.filter(
        (r) =>
          r.key.toLowerCase().includes(searchQ.toLowerCase()) ||
          r.value.toLowerCase().includes(searchQ.toLowerCase())
      )
    : activeRows;

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ color: "var(--text)", fontSize: 18, fontWeight: 500, margin: 0 }}>
          Company Memory
        </h1>
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search memory..."
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text)",
            fontFamily: "inherit",
            fontSize: 12,
            outline: "none",
            padding: "7px 12px",
            width: 200,
          }}
        />
      </div>

      {/* Type tabs */}
      <div style={{ display: "flex", gap: 1, background: "var(--border)", borderRadius: 5, overflow: "hidden", width: "fit-content" }}>
        {MEMORY_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            style={{
              background: activeType === type ? "var(--surface)" : "var(--bg)",
              border: "none",
              color: activeType === type ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              letterSpacing: "0.05em",
              padding: "7px 14px",
              textTransform: "capitalize",
            }}
          >
            {type.replace(/_/g, " ")}
            <span style={{ color: "var(--text-subtle)", marginLeft: 6 }}>
              {memoryByType[type].length}
            </span>
          </button>
        ))}
      </div>

      {/* Memory rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.length === 0 && (
          <p style={{ color: "var(--text-subtle)", fontSize: 13 }}>No {activeType} memory.</p>
        )}
        {filtered.map((record) =>
          editing?.id === record.id ? (
            <div
              key={record.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border-muted)",
                borderRadius: 5,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <p style={{ color: "var(--text-muted)", fontSize: 11, margin: 0, fontWeight: 500 }}>
                {record.key}
              </p>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={5}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text)",
                  fontFamily: "inherit",
                  fontSize: 12,
                  padding: "8px 10px",
                  resize: "vertical",
                  width: "100%",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => void saveEdit()}
                  disabled={isSaving}
                  style={btnStyle(isSaving, "primary")}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  disabled={isSaving}
                  style={btnStyle(isSaving, "ghost")}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              key={record.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "0 0 6px", fontWeight: 500 }}>
                  {record.key}
                </p>
                <p
                  style={{
                    color: "var(--text)",
                    fontSize: 12,
                    margin: 0,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    lineHeight: 1.6,
                  }}
                >
                  {record.value}
                </p>
              </div>
              <button
                onClick={() => { setEditing(record); setEditValue(record.value); }}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                  fontFamily: "inherit",
                  fontSize: 11,
                  padding: "4px 10px",
                }}
              >
                Edit
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean, variant: "primary" | "ghost"): React.CSSProperties {
  return {
    background: variant === "primary" ? (disabled ? "var(--surface-2)" : "var(--text)") : "transparent",
    border: variant === "primary" ? "none" : "1px solid var(--border)",
    borderRadius: 4,
    color: variant === "primary" ? (disabled ? "var(--text-muted)" : "var(--bg)") : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    opacity: disabled ? 0.7 : 1,
    padding: "7px 14px",
  };
}
