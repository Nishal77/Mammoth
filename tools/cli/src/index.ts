import { Command } from "commander";
import { readConfig, writeConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { runInit } from "./commands/init.js";
import { runStart } from "./commands/start.js";
import { runStop } from "./commands/stop.js";
import { runStatus } from "./commands/status.js";
import { runLogs } from "./commands/logs.js";
import { listApprovals, resolveApproval } from "./commands/approve.js";
import { runTrigger } from "./commands/trigger.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runDoctor } from "./commands/doctor.js";
import { runAuthLogin, runAuthLogout, runAuthStatus } from "./commands/auth.js";

const VERSION = "0.1.0";

function handleError(err: unknown): never {
  if (err instanceof Error) {
    logger.error(err.message);
  } else {
    logger.error(String(err));
  }
  process.exit(1);
}

const program = new Command();

program
  .name("mammoth")
  .description("MAMMOTH — AI Company OS management CLI")
  .version(VERSION)
  .option("--project-root <path>", "Override project root directory");

// Resolve --project-root before any subcommand runs
program.hook("preAction", (_, actionCommand) => {
  const opts = program.opts<{ projectRoot?: string }>();
  if (opts.projectRoot) {
    writeConfig({ projectRoot: opts.projectRoot });
  }
  void actionCommand;
});

// ── mammoth init ──────────────────────────────────────────────────
program
  .command("init")
  .description("First-time setup: configure env, pull Docker images, run migrations")
  .action(() => runInit().catch(handleError));

// ── mammoth start ─────────────────────────────────────────────────
program
  .command("start")
  .description("Start all infrastructure services (Postgres, Redis, Qdrant, MinIO)")
  .action(() => runStart().catch(handleError));

// ── mammoth stop ──────────────────────────────────────────────────
program
  .command("stop")
  .description("Stop all infrastructure services")
  .action(() => runStop().catch(handleError));

// ── mammoth restart ───────────────────────────────────────────────
program
  .command("restart")
  .description("Restart all infrastructure services")
  .action(async () => {
    await runStop().catch(handleError);
    await runStart().catch(handleError);
  });

// ── mammoth status ────────────────────────────────────────────────
program
  .command("status")
  .description("Show infrastructure, auth state, and pending approvals")
  .action(() => runStatus().catch(handleError));

// ── mammoth logs ──────────────────────────────────────────────────
program
  .command("logs [service]")
  .description("Tail service logs (postgres|redis|qdrant|minio|all)")
  .option("-f, --follow", "Stream logs continuously", false)
  .action((service: string | undefined, opts: { follow: boolean }) =>
    runLogs(service, opts).catch(handleError)
  );

// ── mammoth approve ───────────────────────────────────────────────
const approveCmd = program
  .command("approve")
  .description("Manage Ring 2 and Ring 3 approvals");

approveCmd
  .command("list")
  .description("List all pending approvals across all companies")
  .action(() => listApprovals().catch(handleError));

approveCmd
  .command("resolve [approvalId]")
  .description("Interactively approve, reject, or modify a pending action")
  .action((approvalId: string | undefined) =>
    resolveApproval(approvalId).catch(handleError)
  );

// Default approve with no subcommand → list
approveCmd.action(() => listApprovals().catch(handleError));

// ── mammoth trigger ───────────────────────────────────────────────
program
  .command("trigger [department]")
  .description("Manually trigger an agent run (ceo-brain|marketing|sales|...)")
  .option("-c, --company <id>", "Company ID (auto-selected if only one)")
  .action((department: string | undefined, opts: { company?: string }) =>
    runTrigger(department, opts.company).catch(handleError)
  );

// ── mammoth upgrade ───────────────────────────────────────────────
program
  .command("upgrade")
  .description("Pull latest Docker images and run new migrations")
  .action(() => runUpgrade().catch(handleError));

// ── mammoth doctor ────────────────────────────────────────────────
program
  .command("doctor")
  .description("Check prerequisites and configuration")
  .action(() => runDoctor().catch(handleError));

// ── mammoth auth ──────────────────────────────────────────────────
const authCmd = program
  .command("auth")
  .description("Authenticate with the local MAMMOTH API");

authCmd
  .command("login")
  .description("Sign in with email and password")
  .action(() => runAuthLogin().catch(handleError));

authCmd
  .command("logout")
  .description("Clear stored credentials")
  .action(() => runAuthLogout());

authCmd
  .command("status")
  .description("Show current authentication state")
  .action(() => runAuthStatus());

// ── mammoth config ────────────────────────────────────────────────
const configCmd = program
  .command("config")
  .description("View and manage CLI configuration");

configCmd
  .command("show")
  .description("Print current config (redacts token)")
  .action(() => {
    const config = readConfig();
    const safe = { ...config, authToken: config.authToken ? "[set]" : null };
    console.log(JSON.stringify(safe, null, 2));
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value (e.g. apiUrl http://localhost:4000)")
  .action((key: string, value: string) => {
    const allowed: Array<keyof ReturnType<typeof readConfig>> = ["apiUrl", "projectRoot"];
    if (!allowed.includes(key as keyof ReturnType<typeof readConfig>)) {
      logger.error(`Unknown key "${key}". Allowed: ${allowed.join(", ")}`);
      process.exit(1);
    }
    writeConfig({ [key]: value });
    logger.success(`Set ${key} = ${value}`);
  });

program.parseAsync(process.argv).catch(handleError);
