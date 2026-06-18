"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { getSocket, subscribeCompany, onMammothEvent } from "@/lib/socket-client";
import { DepartmentGrid } from "@/components/DepartmentGrid";
import { GoalCard } from "@/components/GoalCard";
import { MetricStrip } from "@/components/MetricStrip";
import { PendingApprovalsBadge } from "@/components/PendingApprovalsBadge";
import { AgentActivityFeed } from "@/components/AgentActivityFeed";
import type { MammothEvent } from "@mammoth/shared/events";

type Company = { id: string; name: string; stage: string | null };
type Goal = {
  id: string; title: string; type: string;
  targetValue: string; currentValue: string;
  unit: string; deadline: string; status: string;
};
type MetricSummary = {
  mrr: string | null; totalRevenue: string | null;
  totalLeads: number; totalCustomers: number; totalTasks: number;
};
type Department = { id: string; name: string; status: string; ringLevel?: number };
type DashboardData = {
  company: Company; goal: Goal | null;
  metrics: MetricSummary; departments: Department[]; pendingApprovals: number;
};

export function DashboardClient() {
  const { data: session } = useSession();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [activeDepts, setActiveDepts] = useState<Set<string>>(new Set());

  const loadDashboard = useCallback(async (cId: string) => {
    const [goalRows, deptRes, metricsRes, approvalRows] = await Promise.all([
      api.get<Goal[]>(`/companies/${cId}/goals`),
      api.get<Department[]>(`/companies/${cId}/departments`),
      api.get<MetricSummary>(`/companies/${cId}/metrics/summary`),
      api.get<{ id: string; status: string }[]>(`/companies/${cId}/approvals`),
    ]);

    return {
      goal: goalRows.find((g) => g.status === "active") ?? null,
      departments: deptRes,
      metrics: metricsRes,
      pendingApprovals: approvalRows.filter((a) => a.status === "pending").length,
    };
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const companies = await api.get<Company[]>("/companies");
        const company = companies[0];
        if (!company) { window.location.href = "/onboarding"; return; }
        const rest = await loadDashboard(company.id);
        setPendingApprovals(rest.pendingApprovals);
        setDashboardData({ company, ...rest });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [loadDashboard]);

  // Socket.IO subscription for live dept status updates
  useEffect(() => {
    const token = (session?.session as { token?: string } | undefined)?.token;
    const companyId = dashboardData?.company.id;
    if (!token || !companyId) return;

    const socket = getSocket(token);
    subscribeCompany(socket, companyId);

    return onMammothEvent(socket, (event: MammothEvent) => {
      if (event.event === "task:started") {
        setActiveDepts((prev) => new Set([...prev, event.department]));
      }
      if (event.event === "task:completed" || event.event === "task:failed") {
        setActiveDepts((prev) => { const n = new Set(prev); n.delete(event.department); return n; });
      }
      if (event.event === "approval:created") {
        setPendingApprovals((prev) => prev + 1);
      }
    });
  }, [session, dashboardData?.company.id]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!dashboardData) return null;

  const { company, goal, metrics, departments } = dashboardData;

  const enrichedDepts = departments.map((d) => ({
    ...d,
    status: activeDepts.has(d.name) ? "running" : d.status,
  }));

  const token = (session?.session as { token?: string } | undefined)?.token ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "var(--text)" }}>
            {company.name}
          </h1>
          {company.stage && (
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12 }}>{company.stage}</p>
          )}
        </div>
        {pendingApprovals > 0 && <PendingApprovalsBadge count={pendingApprovals} />}
      </div>

      <MetricStrip metrics={metrics} />
      {goal && <GoalCard goal={goal} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
        <div>
          <SectionHeader>Departments</SectionHeader>
          <DepartmentGrid departments={enrichedDepts} companyId={company.id} />
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "20px 18px",
            maxHeight: 520,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SectionHeader>Agent activity</SectionHeader>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <AgentActivityFeed
              companyId={company.id}
              token={token}
              onApprovalCreated={() => setPendingApprovals((p) => p + 1)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 400, letterSpacing: "0.1em", margin: "0 0 16px", textTransform: "uppercase" }}>
      {children}
    </h2>
  );
}

function LoadingState() {
  return <div style={{ color: "var(--text-muted)", fontSize: 13, paddingTop: 48 }}>Loading...</div>;
}

function ErrorState({ message }: { message: string }) {
  return <div style={{ color: "var(--red)", fontSize: 13, paddingTop: 48 }}>{message}</div>;
}
