"use client";

import Link from "next/link";

export function Navbar() {
  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        borderBottom: "1px solid var(--border)",
        backgroundColor: "rgba(10, 10, 10, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{
            textDecoration: "none",
            color: "var(--text)",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "0.08em",
          }}
        >
          MAMMOTH
        </Link>

        {/* Nav links */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Link href="#features" style={navLinkStyle}>
            Features
          </Link>
          <Link href="#how-it-works" style={navLinkStyle}>
            How it works
          </Link>
          <Link href="#pricing" style={navLinkStyle}>
            Pricing
          </Link>
        </div>

        {/* CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/login" style={navLinkStyle}>
            Log in
          </Link>
          <Link
            href="/signup"
            style={{
              padding: "7px 16px",
              backgroundColor: "var(--text)",
              color: "var(--bg)",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.04em",
              borderRadius: 4,
            }}
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  textDecoration: "none",
  fontSize: 12,
  letterSpacing: "0.04em",
  transition: "color 0.15s",
};
