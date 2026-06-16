import { Sidebar } from "@/components/Sidebar";
import { LiveActivityBar } from "@/components/LiveActivityBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <LiveActivityBar />
        <main style={{ flex: 1, padding: "24px 32px", overflow: "auto" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
