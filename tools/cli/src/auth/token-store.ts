import { readConfig, writeConfig } from "../lib/config.js";

export type AuthState =
  | { isAuthenticated: false }
  | { isAuthenticated: true; token: string; email: string };

export function getAuthState(): AuthState {
  const config = readConfig();
  if (!config.authToken || !config.authEmail) {
    return { isAuthenticated: false };
  }
  return {
    isAuthenticated: true,
    token: config.authToken,
    email: config.authEmail,
  };
}

export function saveToken(token: string, email: string): void {
  writeConfig({ authToken: token, authEmail: email });
}

export function clearToken(): void {
  writeConfig({ authToken: null, authEmail: null });
}

export function requireAuth(): { token: string; email: string } {
  const state = getAuthState();
  if (!state.isAuthenticated) {
    console.error("Not authenticated. Run: mammoth auth login");
    process.exit(1);
  }
  return { token: state.token, email: state.email };
}
