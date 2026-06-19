import { readConfig } from "../lib/config.js";
import { requireAuth } from "../auth/token-store.js";

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string; code: string };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  skipAuth = false
): Promise<T> {
  const config = readConfig();
  const url = `${config.apiUrl}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!skipAuth) {
    const auth = requireAuth();
    headers["Authorization"] = `Bearer ${auth.token}`;
  }

  const fetchInit: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
  };
  if (body != null) {
    fetchInit.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchInit);

  const json = (await response.json()) as ApiResponse<T>;

  if (!response.ok) {
    const errJson = json as { success: false; error: string };
    throw new Error(errJson.error ?? `HTTP ${response.status}`);
  }

  if (!json.success) {
    throw new Error(json.error);
  }

  return json.data;
}

export type Company = {
  id: string;
  name: string;
  slug: string;
  stage: string | null;
};

export type PendingApproval = {
  id: string;
  companyId: string;
  department: string;
  actionType: string;
  ringLevel: 1 | 2 | 3;
  proposedContent: string;
  createdAt: string;
  vetoDeadline: string | null;
};

export type ResolveAction = "approved" | "rejected" | "modified";

export const apiClient = {
  health: () => request<{ status: string }>("GET", "/health", undefined, true),

  signIn: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string } }>(
      "POST",
      "/api/auth/sign-in/email",
      { email, password },
      true
    ),

  listCompanies: () => request<Company[]>("GET", "/api/v1/companies"),

  listPendingApprovals: (companyId: string) =>
    request<PendingApproval[]>(
      "GET",
      `/api/v1/companies/${companyId}/approvals?status=pending`
    ),

  resolveApproval: (
    companyId: string,
    approvalId: string,
    action: ResolveAction,
    modifiedContent?: string
  ) =>
    request<{ id: string; status: string }>(
      "POST",
      `/api/v1/companies/${companyId}/approvals/${approvalId}/resolve`,
      { action, modifiedContent }
    ),

  triggerAgent: (companyId: string, department: string) =>
    request<{ jobId: string }>("POST", `/api/v1/companies/${companyId}/trigger`, {
      department,
    }),
};
