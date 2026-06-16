const API_BASE = "/api/v1";

type ApiResponse<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: string;
  code: string;
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });

  const body = await response.json() as ApiResponse<T>;

  if (!response.ok || !body.success) {
    const errBody = body as { success: false; error: string; code: string };
    throw new ApiError(
      errBody.code ?? "UNKNOWN",
      errBody.error ?? `HTTP ${response.status}`,
      response.status
    );
  }

  return (body as { success: true; data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
