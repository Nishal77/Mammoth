"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

// ─── Icons ────────────────────────────────────────────────────────────────────

function DashboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="1" y="1" width="5" height="5" rx="0.5" />
      <rect x="8" y="1" width="5" height="5" rx="0.5" />
      <rect x="1" y="8" width="5" height="5" rx="0.5" />
      <rect x="8" y="8" width="5" height="5" rx="0.5" />
    </svg>
  );
}

function GoalsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="7" cy="7" r="5.5" />
      <circle cx="7" cy="7" r="3" />
      <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function DepartmentsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="1" width="6" height="3.5" rx="0.5" />
      <rect x="1" y="9.5" width="4" height="3.5" rx="0.5" />
      <rect x="9" y="9.5" width="4" height="3.5" rx="0.5" />
      <path d="M7 4.5v2.5M7 7H3v2.5M7 7h4v2.5" />
    </svg>
  );
}

function ApprovalsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5.5" />
      <path d="M4.5 7l2 2 3-3.5" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M1.5 3.5h11M1.5 7h11M1.5 10.5h7.5" />
    </svg>
  );
}

function IntegrationsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 2l4 5-4 5" />
      <path d="M5.5 4L1.5 7l4 3" />
      <path d="M5.5 7h3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1 1M10.1 10.1l1 1M2.9 11.1l1-1M10.1 3.9l1-1" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  showBadge?: boolean;
};

type NavSection = {
  label?: string;
  items: NavItem[];
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * App sidebar — fixed-width nav with grouped sections and live approval badge.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [pendingCount, setPendingCount] = useState(0);

  // Fetch pending approvals count every 30s for the badge
  useEffect(() => {
    const companyId = (session?.user as { companyId?: string } | undefined)?.companyId;
    if (!companyId) return;

    async function fetchCount() {
      try {
        const rows = await api.get<{ status: string }[]>(`/companies/${companyId}/approvals`);
        setPendingCount(rows.filter((r) => r.status === "pending").length);
      } catch {
        // Badge is non-critical — silently skip on error
      }
    }

    void fetchCount();
    const interval = setInterval(() => void fetchCount(), 30_000);
    return () => clearInterval(interval);
  }, [session]);

  const sections: NavSection[] = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: <DashboardIcon /> },
        { href: "/goals", label: "Goals", icon: <GoalsIcon /> },
      ],
    },
    {
      label: "Operations",
      items: [
        { href: "/departments", label: "Departments", icon: <DepartmentsIcon /> },
        { href: "/approvals", label: "Approvals", icon: <ApprovalsIcon />, showBadge: true },
      ],
    },
    {
      label: "Data",
      items: [
        { href: "/memory", label: "Memory", icon: <MemoryIcon /> },
        { href: "/integrations", label: "Integrations", icon: <IntegrationsIcon /> },
      ],
    },
  ];

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      style={{
        width: 220,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--bg)",
      }}
    >
      {/* Brand */}
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border-muted)" }}>
        <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em" }}>
          MERIDIAN
        </span>
        <p style={{ color: "var(--text-subtle)", fontSize: 10, margin: "3px 0 0", letterSpacing: "0.04em" }}>
          AI Company OS
        </p>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, padding: "10px 0", overflowY: "auto" }}>
        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: 2 }}>
            {section.label && (
              <p style={{
                color: "var(--text-subtle)",
                fontSize: 10,
                letterSpacing: "0.12em",
                margin: "14px 20px 6px",
                textTransform: "uppercase",
              }}>
                {section.label}
              </p>
            )}

            {section.items.map(({ href, label, icon, showBadge }) => {
              const active = isActive(href);
              const badge = showBadge && pendingCount > 0;

              return (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 20px",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    textDecoration: "none",
                    fontSize: 13,
                    background: active ? "var(--surface)" : "transparent",
                    borderLeft: active ? "1px solid var(--text)" : "1px solid transparent",
                    transition: "color 0.1s, background 0.1s",
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.55, flexShrink: 0 }}>{icon}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {badge && (
                    <span style={{
                      background: "var(--yellow)",
                      color: "#000",
                      fontSize: 10,
                      fontWeight: 600,
                      borderRadius: 10,
                      padding: "1px 6px",
                      lineHeight: "16px",
                      flexShrink: 0,
                    }}>
                      {pendingCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Settings — separated at bottom of nav */}
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border-muted)", paddingTop: 8 }}>
          <Link
            href="/settings"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 20px",
              color: isActive("/settings") ? "var(--text)" : "var(--text-muted)",
              textDecoration: "none",
              fontSize: 13,
              background: isActive("/settings") ? "var(--surface)" : "transparent",
              borderLeft: isActive("/settings") ? "1px solid var(--text)" : "1px solid transparent",
            }}
          >
            <span style={{ opacity: isActive("/settings") ? 1 : 0.55 }}><SettingsIcon /></span>
            <span>Settings</span>
          </Link>
        </div>
      </div>

      {/* User + sign out */}
      <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-muted)" }}>
        <p style={{
          color: "var(--text-muted)",
          fontSize: 11,
          margin: "0 0 8px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {session?.user?.email ?? ""}
        </p>
        <button
          onClick={() => void signOut()}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-subtle)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            padding: 0,
          }}
        >
          Sign out →
        </button>
      </div>
    </nav>
  );
}
