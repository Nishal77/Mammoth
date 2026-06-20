"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { getSocket, subscribeCompany, onMammothEvent } from "@/lib/socket-client";
import { DepartmentGrid } from "@/components/DepartmentGrid";
import { GoalCard } from "@/components/GoalCard";
import { MetricStrip } from "@/components/MetricStrip";
import { AgentActivityFeed } from "@/components/AgentActivityFeed";
import type { MammothEvent } from "@mammoth/shared/events";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  company: Company;
  goal: Goal | null;
  metrics: MetricSummary;
  departments: Department[];
  pendingApprovals: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Main dashboard — shows the active goal, live metrics, all 9 departments,
 * and a real-time activity feed. Everything a founder needs to see at a glance.
 */
export function DashboardClient() {
  const { data: session } = useSession();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // Tracks which departments are running right now (dept name → true)
  const [activeDepts, setActiveDepts] = useState<Set<string>>(new Set());
  // Tracks the current task title per department while it's running
  const [runningTasks, setRunningTasks] = useState<Record<string, string>>({});

  const loadDashboard = useCallback(async (companyId: string) => {
    const [goalRows, deptRes, metricsRes, approvalRows] = await Promise.all([
      api.get<Goal[]>(`/companies/${companyId}/goals`),
      api.get<Department[]>(`/companies/${companyId}/departments`),
      api.get<MetricSummary>(`/companies/${companyId}/metrics/summary`),
      api.get<{ id: string; status: string }[]>(`/companies/${companyId}/approvals`),
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

  // Socket.IO — live dept status + task tracking
  useEffect(() => {
    const token = (session?.session as { token?: string } | undefined)?.token;
    const companyId = dashboardData?.company.id;
    if (!token || !companyId) return;

    const socket = getSocket(token);
    subscribeCompany(socket, companyId);

    return onMammothEvent(socket, (event: MammothEvent) => {
      if (event.event === "task:started") {
        setActiveDepts((prev) => new Set([...prev, event.department]));
        setRunningTasks((prev) => ({ ...prev, [event.department]: event.title }));
      }

      if (event.event === "task:completed" || event.event === "task:failed") {
        setActiveDepts((prev) => {
          const next = new Set(prev);
          next.delete(event.department);
          return next;
        });
        setRunningTasks((prev) => {
          const next = { ...prev };
          delete next[event.department];
          return next;
        });
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

  // Enrich departments with live running state and current task title
  const enrichedDepts = departments.map((d) => {
    const task = runningTasks[d.name];
    return {
      ...d,
      status: activeDepts.has(d.name) ? "running" : d.status,
      ...(task !== undefined ? { currentTask: task } : {}),
    };
  });

  const runningCount = activeDepts.size;
  const token = (session?.session as { token?: string } | undefined)?.token ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--text)" }}>
            {company.name}
          </h1>
          {company.stage && (
            <p style={{ margin: "3px 0 0", color: "var(--text-muted)", fontSize: 11 }}>
              {company.stage}
            </p>
          )}
        </div>

        {/* Live system status — shows what's active right now */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <StatusChip
            count={runningCount}
            label="running"
            color="var(--green)"
            pulse={runningCount > 0}
          />
          {pendingApprovals > 0 && (
            <Link href="/approvals" style={{ textDecoration: "none" }}>
              <StatusChip
                count={pendingApprovals}
                label="need approval"
                color="var(--yellow)"
                pulse={false}
              />
            </Link>
          )}
        </div>
      </div>

      {/* ── Goal progress ──────────────────────────────────────── */}
      {goal && <GoalCard goal={goal} />}

      {/* ── Key metrics ────────────────────────────────────────── */}
      <MetricStrip metrics={metrics} />

      {/* ── Departments + Activity feed (side by side) ─────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>

        {/* Departments — 3x3 grid of all 9 AI departments */}
        <div>
          <SectionHeader>
            Departments
            <span style={{ color: "var(--text-subtle)", fontWeight: 400, marginLeft: 8 }}>
              {enrichedDepts.length} total
            </span>
          </SectionHeader>
          <DepartmentGrid departments={enrichedDepts} companyId={company.id} />
        </div>

        {/* Activity feed — live stream of agent events */}
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "18px 16px",
          maxHeight: 540,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}>
          <SectionHeader>Live activity</SectionHeader>
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      color: "var(--text-muted)",
      fontSize: 11,
      fontWeight: 400,
      letterSpacing: "0.1em",
      margin: "0 0 14px",
      textTransform: "uppercase",
      display: "flex",
      alignItems: "center",
    }}>
      {children}
    </h2>
  );
}

/** Small pill showing a count + label — used for "3 running", "2 need approval" */
function StatusChip({
  count,
  label,
  color,
  pulse,
}: {
  count: number;
  label: string;
  color: string;
  pulse: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        animation: pulse ? "pulse 1.5s ease-in-out infinite" : "none",
      }} />
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
        <span style={{ color, fontWeight: 500 }}>{count}</span>
        {" "}{label}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: 13, paddingTop: 48 }}>
      Loading...
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ color: "var(--red)", fontSize: 13, paddingTop: 48 }}>
      {message}
    </div>
  );
}
