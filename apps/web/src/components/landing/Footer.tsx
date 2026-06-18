import Link from "next/link";

export function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "40px 24px",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {/* Brand */}
        <span
          style={{
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.08em",
            color: "var(--text-muted)",
          }}
        >
          MAMMOTH
        </span>

        {/* Links */}
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            { label: "Docs", href: "/docs" },
            { label: "Status", href: "/status" },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              style={{
                fontSize: 11,
                color: "var(--text-subtle)",
                textDecoration: "none",
                letterSpacing: "0.04em",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Copyright */}
        <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
          © {new Date().getFullYear()} MAMMOTH. All rights reserved.
        </span>
      </div>
    </footer>
  );
}
