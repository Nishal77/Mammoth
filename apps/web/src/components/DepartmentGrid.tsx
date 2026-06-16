"use client";

import Link from "next/link";

const RING_COLORS: Record<number, string> = {
  1: "var(--ring-1)",
  2: "var(--ring-2)",
  3: "var(--ring-3)",
};

const STATUS_COLORS: Record<string, string> = {
  running: "var(--green)",
  idle: "var(--text-subtle)",
  failed: "var(--red)",
  paused: "var(--yellow)",
};

type Department = {
  id: string;
  name: string;
  status: string;
  ringLevel?: number;
};

export function DepartmentGrid({
  departments,
  companyId,
}: {
  departments: Department[];
  companyId: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
      }}
    >
      {departments.map((dept) => (
        <DepartmentCard key={dept.id} dept={dept} companyId={companyId} />
      ))}
    </div>
  );
}

function DepartmentCard({
  dept,
  companyId,
}: {
  dept: Department;
  companyId: string;
}) {
  const statusColor = STATUS_COLORS[dept.status] ?? "var(--text-subtle)";
  const ringColor = dept.ringLevel ? RING_COLORS[dept.ringLevel] : null;

  return (
    <Link
      href={`/departments/${dept.name}?company=${companyId}`}
      style={{ textDecoration: "none" }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "16px 18px",
          cursor: "pointer",
          transition: "border-color 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-muted)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, textTransform: "capitalize" }}>
            {dept.name}
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
              flexShrink: 0,
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "capitalize" }}>
            {dept.status}
          </span>
          {dept.ringLevel && (
            <span
              style={{
                border: `1px solid ${ringColor}`,
                borderRadius: 3,
                color: ringColor ?? "var(--text-muted)",
                fontSize: 10,
                letterSpacing: "0.05em",
                padding: "2px 6px",
              }}
            >
              Ring {dept.ringLevel}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
