import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAMMOTH_DIR = path.join(os.homedir(), ".mammoth");
const CONFIG_FILE = path.join(MAMMOTH_DIR, "config.json");

export type SetupMode = "cloud" | "local";

export type MammothConfig = {
  mode: SetupMode | null;
  apiUrl: string;
  authToken: string | null;
  authEmail: string | null;
  setupComplete: boolean;
};

const DEFAULT_CONFIG: MammothConfig = {
  mode: null,
  apiUrl: "http://localhost:4000",
  authToken: null,
  authEmail: null,
  setupComplete: false,
};

function ensureDir(): void {
  if (!fs.existsSync(MAMMOTH_DIR)) {
    fs.mkdirSync(MAMMOTH_DIR, { recursive: true, mode: 0o700 });
  }
}

export function readConfig(): MammothConfig {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as MammothConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(updates: Partial<MammothConfig>): void {
  ensureDir();
  const next = { ...readConfig(), ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function getMammothDir(): string {
  ensureDir();
  return MAMMOTH_DIR;
}

export function getEnvFilePath(): string {
  return path.join(MAMMOTH_DIR, ".env");
}

export function writeEnvFile(values: Record<string, string>): void {
  ensureDir();
  const lines = Object.entries(values)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(getEnvFilePath(), lines.join("\n") + "\n", { mode: 0o600 });
}

export function readEnvFile(): Record<string, string> {
  const envPath = getEnvFilePath();
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const result: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) result[key] = val;
    }
  }
  return result;
}
