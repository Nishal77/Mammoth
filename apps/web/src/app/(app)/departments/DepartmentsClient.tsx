"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

type Department = {
  id: string;
  name: string;
  status: string;
  ringDefaults: { defaultRing: number } | null;
  playbook: string | null;
  playbookVersion: number;
  updatedAt: string;
};

type TaskRun = {
  id: string;
  taskType: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function DepartmentsClient() {
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selected, setSelected] = useState<Department | null>(null);
  const [recentRuns, setRecentRuns] = useState<TaskRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const companies = await api.get<{ id: string }[]>("/companies");
        const cId = companies[0]?.id;
        if (!cId) return;
        setCompanyId(cId);
        const depts = await api.get<Department[]>(`/companies/${cId}/departments`);
        setDepartments(depts);

        const deptName = searchParams.get("dept");
        if (deptName) {
          const match = depts.find((d) => d.name === deptName) ?? null;
          setSelected(match);
        }
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [searchParams]);

  useEffect(() => {
    if (!selected || !companyId) return;
    void api
      .get<TaskRun[]>(`/companies/${companyId}/departments/${selected.name}/tasks?limit=10`)
      .then(setRecentRuns)
      .catch(() => setRecentRuns([]));
  }, [selected, companyId]);

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</p>;

  return (
    <div style={{ display: "flex", gap: 24, maxWidth: 1100 }}>
      {/* Department list */}
      <div style={{ flex: "0 0 220px", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.1em", margin: "0 0 12px", textTransform: "uppercase" }}>
          Departments
        </p>
        {departments.map((dept) => (
          <button
            key={dept.id}
            onClick={() => setSelected(dept)}
            style={{
              background: selected?.id === dept.id ? "var(--surface-2)" : "transparent",
              border: `1px solid ${selected?.id === dept.id ? "var(--border-muted)" : "transparent"}`,
              borderRadius: 4,
              color: selected?.id === dept.id ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              padding: "8px 12px",
              textAlign: "left",
              textTransform: "capitalize",
              width: "100%",
            }}
          >
            {dept.name}
            <span
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background:
                  dept.status === "running" ? "var(--green)" :
                  dept.status === "failed" ? "var(--red)" :
                  "var(--text-subtle)",
                float: "right",
                marginTop: 4,
              }}
            />
          </button>
        ))}
      </div>

      {/* Detail */}
      {selected ? (
        <DepartmentDetail dept={selected} runs={recentRuns} companyId={companyId ?? ""} />
      ) : (
        <div style={{ flex: 1, color: "var(--text-muted)", fontSize: 13, paddingTop: 4 }}>
          Select a department.
        </div>
      )}
    </div>
  );
}

function DepartmentDetail({
  dept,
  runs,
  companyId,
}: {
  dept: Department;
  runs: TaskRun[];
  companyId: string;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "20px 24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 500, margin: "0 0 4px", textTransform: "capitalize" }}>
              {dept.name}
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
              Status: <span style={{ textTransform: "capitalize" }}>{dept.status}</span>
              {" "}· Default ring: {dept.ringDefaults?.defaultRing ?? 2}
              {" "}· Playbook v{dept.playbookVersion}
            </p>
          </div>
          <Link
            href={`/departments/${dept.name}/playbook?company=${companyId}`}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              fontSize: 12,
              padding: "6px 12px",
              textDecoration: "none",
            }}
          >
            Edit playbook
          </Link>
        </div>
      </div>

      {/* Recent task runs */}
      <div>
        <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.1em", margin: "0 0 12px", textTransform: "uppercase" }}>
          Recent tasks
        </p>
        {runs.length === 0 ? (
          <p style={{ color: "var(--text-subtle)", fontSize: 13 }}>No tasks yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {runs.map((run) => (
              <div
                key={run.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                }}
              >
                <span style={{ color: "var(--text)", fontSize: 12, textTransform: "capitalize" }}>
                  {run.taskType.replace(/_/g, " ")}
                </span>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span
                    style={{
                      color:
                        run.status === "completed" ? "var(--green)" :
                        run.status === "failed" ? "var(--red)" :
                        run.status === "running" ? "var(--yellow)" :
                        "var(--text-muted)",
                      fontSize: 11,
                      textTransform: "capitalize",
                    }}
                  >
                    {run.status}
                  </span>
                  {run.startedAt && (
                    <span style={{ color: "var(--text-subtle)", fontSize: 11 }}>
                      {new Date(run.startedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
