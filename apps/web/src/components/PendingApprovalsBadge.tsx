"use client";

import Link from "next/link";

export function PendingApprovalsBadge({ count }: { count: number }) {
  return (
    <Link
      href="/approvals"
      style={{ textDecoration: "none" }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--yellow)",
          borderRadius: 4,
          color: "var(--yellow)",
          fontSize: 12,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--yellow)",
            animation: "pulse 2s infinite",
          }}
        />
        {count} pending {count === 1 ? "approval" : "approvals"}
      </div>
    </Link>
  );
}
