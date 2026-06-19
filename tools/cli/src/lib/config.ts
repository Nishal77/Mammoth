import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAMMOTH_DIR = path.join(os.homedir(), ".mammoth");
const CONFIG_FILE = path.join(MAMMOTH_DIR, "config.json");

export type MammothConfig = {
  projectRoot: string | null;
  apiUrl: string;
  authToken: string | null;
  authEmail: string | null;
  setupComplete: boolean;
};

const DEFAULT_CONFIG: MammothConfig = {
  projectRoot: null,
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
  const current = readConfig();
  const next = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
}

export function clearConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
}

export function getMammothDir(): string {
  ensureDir();
  return MAMMOTH_DIR;
}
