"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/approvals", label: "Approvals" },
  { href: "/departments", label: "Departments" },
  { href: "/memory", label: "Memory" },
  { href: "/goals", label: "Goals" },
  { href: "/settings", label: "Settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <nav
      style={{
        width: 200,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "20px 0",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "0 20px 24px", borderBottom: "1px solid var(--border-muted)" }}>
        <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, letterSpacing: "0.05em" }}>
          MAMMOTH
        </span>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, padding: "16px 0" }}>
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "block",
                padding: "7px 20px",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                textDecoration: "none",
                fontSize: 13,
                background: isActive ? "var(--surface)" : "transparent",
                borderLeft: isActive ? "1px solid var(--text)" : "1px solid transparent",
                transition: "color 0.1s, background 0.1s",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* User */}
      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-muted)" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "0 0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
          Sign out
        </button>
      </div>
    </nav>
  );
}
