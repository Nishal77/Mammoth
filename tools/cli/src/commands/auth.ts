import inquirer from "inquirer";
import ora from "ora";
import { apiClient } from "../api/client.js";
import { saveToken, clearToken, getAuthState } from "../auth/token-store.js";
import { logger } from "../lib/logger.js";

export async function runAuthLogin(): Promise<void> {
  const { email, password } = await inquirer.prompt<{
    email: string;
    password: string;
  }>([
    {
      type: "input",
      name: "email",
      message: "Email:",
      validate: (v: string) => v.includes("@") || "Enter a valid email",
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
      validate: (v: string) => v.length > 0 || "Password required",
    },
  ]);

  const spinner = ora("Authenticating").start();
  try {
    const result = await apiClient.signIn(email, password);
    saveToken(result.token, email);
    spinner.succeed(`Authenticated as ${email}`);
  } catch (err) {
    spinner.fail("Authentication failed");
    logger.error(err instanceof Error ? err.message : "Invalid credentials");
    process.exit(1);
  }
}

export function runAuthLogout(): void {
  clearToken();
  logger.success("Logged out.");
}

export function runAuthStatus(): void {
  const state = getAuthState();
  if (state.isAuthenticated) {
    logger.info(`Authenticated as ${state.email}`);
  } else {
    logger.warn("Not authenticated. Run: mammoth auth login");
  }
}
