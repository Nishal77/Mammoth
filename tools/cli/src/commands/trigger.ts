import inquirer from "inquirer";
import ora from "ora";
import { apiClient } from "../api/client.js";
import { logger } from "../lib/logger.js";

const DEPARTMENTS = [
  "ceo-brain",
  "marketing",
  "sales",
  "engineering",
  "support",
  "finance",
  "research",
  "hr",
  "content",
] as const;

export async function runTrigger(
  department: string | undefined,
  companyId: string | undefined
): Promise<void> {
  const companies = await apiClient.listCompanies();
  if (companies.length === 0) {
    logger.error("No companies found. Onboard one first via the web dashboard.");
    process.exit(1);
  }

  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId) {
    if (companies.length === 1) {
      resolvedCompanyId = companies[0]!.id;
    } else {
      const { selected } = await inquirer.prompt<{ selected: string }>([
        {
          type: "list",
          name: "selected",
          message: "Select company:",
          choices: companies.map((c) => ({ name: c.name, value: c.id })),
        },
      ]);
      resolvedCompanyId = selected;
    }
  }

  let resolvedDept = department;
  if (!resolvedDept) {
    const { selected } = await inquirer.prompt<{ selected: string }>([
      {
        type: "list",
        name: "selected",
        message: "Select department to trigger:",
        choices: DEPARTMENTS.map((d) => ({ name: d, value: d })),
      },
    ]);
    resolvedDept = selected;
  }

  if (!DEPARTMENTS.includes(resolvedDept as (typeof DEPARTMENTS)[number])) {
    logger.error(`Unknown department "${resolvedDept}". Valid: ${DEPARTMENTS.join(", ")}`);
    process.exit(1);
  }

  const spinner = ora(`Triggering ${resolvedDept} agent`).start();
  try {
    const result = await apiClient.triggerAgent(resolvedCompanyId, resolvedDept);
    spinner.succeed(`Job queued: ${result.jobId}`);
    logger.dim("Watch progress: mammoth logs api --follow");
  } catch (err) {
    spinner.fail("Trigger failed");
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
