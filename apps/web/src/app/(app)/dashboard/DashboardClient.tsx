"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { DepartmentGrid } from "@/components/DepartmentGrid";
import { GoalCard } from "@/components/GoalCard";
import { MetricStrip } from "@/components/MetricStrip";
import { PendingApprovalsBadge } from "@/components/PendingApprovalsBadge";

type Company = {
  id: string;
  name: string;
  stage: string | null;
};

type Goal = {
  id: string;
  title: string;
  type: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  deadline: string;
  status: string;
};

type MetricSummary = {
  mrr: string | null;
  totalRevenue: string | null;
  totalLeads: number;
  totalCustomers: number;
  totalTasks: number;
};

type Department = {
  id: string;
  name: string;
  status: string;
  ringLevel?: number;
};

type DashboardData = {
  company: Company;
  goal: Goal | null;
  metrics: MetricSummary;
  departments: Department[];
  pendingApprovals: number;
};

export function DashboardClient() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (cId: string) => {
    const [goalRows, deptRes, metricsRes, approvalRows] = await Promise.all([
      api.get<Goal[]>(`/companies/${cId}/goals`),
      api.get<Department[]>(`/companies/${cId}/departments`),
      api.get<MetricSummary>(`/companies/${cId}/metrics/summary`),
      api.get<{ id: string; status: string }[]>(`/companies/${cId}/approvals`),
    ]);

    const activeGoal = goalRows.find((g) => g.status === "active") ?? null;

    return {
      goal: activeGoal,
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
        if (!company) {
          window.location.href = "/onboarding";
          return;
        }

        setCompanyId(company.id);
        const rest = await loadDashboard(company.id);
        setDashboardData({ company, ...rest });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setIsLoading(false);
      }
    }

    void init();
  }, [loadDashboard]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!dashboardData) return null;

  const { company, goal, metrics, departments, pendingApprovals } = dashboardData;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "var(--text)" }}>
            {company.name}
          </h1>
          {company.stage && (
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
              {company.stage}
            </p>
          )}
        </div>
        {pendingApprovals > 0 && (
          <PendingApprovalsBadge count={pendingApprovals} />
        )}
      </div>

      {/* Metrics strip */}
      <MetricStrip metrics={metrics} />

      {/* Active goal */}
      {goal && <GoalCard goal={goal} />}

      {/* Department grid */}
      <div>
        <SectionHeader>Departments</SectionHeader>
        <DepartmentGrid departments={departments} companyId={company.id} />
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: "var(--text-muted)",
        fontSize: 11,
        fontWeight: 400,
        letterSpacing: "0.1em",
        margin: "0 0 16px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </h2>
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
