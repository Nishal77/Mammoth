import inquirer from "inquirer";
import chalk from "chalk";
import { apiClient, type PendingApproval, type ResolveAction } from "../api/client.js";
import { logger } from "../lib/logger.js";

function ringBadge(ring: 1 | 2 | 3): string {
  if (ring === 2) return chalk.yellow("[Ring 2]");
  if (ring === 3) return chalk.red("[Ring 3]");
  return chalk.green("[Ring 1]");
}

function formatApproval(a: PendingApproval, idx: number): void {
  console.log();
  console.log(
    `  ${chalk.bold(`#${idx + 1}`)}  ${chalk.white(a.actionType)}  ${ringBadge(a.ringLevel)}`
  );
  console.log(`      Department: ${chalk.cyan(a.department)}`);
  console.log(`      Created:    ${new Date(a.createdAt).toLocaleString()}`);
  if (a.vetoDeadline) {
    const remaining = Math.round(
      (new Date(a.vetoDeadline).getTime() - Date.now()) / 60_000
    );
    const label = remaining > 0 ? chalk.yellow(`${remaining}m remaining`) : chalk.red("expired");
    console.log(`      Veto by:    ${label}`);
  }
  console.log(`      Content:\n`);
  const lines = a.proposedContent.slice(0, 400).split("\n");
  for (const line of lines) {
    console.log(`        ${chalk.dim(line)}`);
  }
  if (a.proposedContent.length > 400) {
    console.log(chalk.dim("        ... (truncated)"));
  }
}

async function fetchAllPending(): Promise<
  Array<{ companyId: string; approval: PendingApproval }>
> {
  const companies = await apiClient.listCompanies();
  const allPending: Array<{ companyId: string; approval: PendingApproval }> = [];

  await Promise.all(
    companies.map(async (company) => {
      const approvals = await apiClient.listPendingApprovals(company.id);
      for (const approval of approvals) {
        allPending.push({ companyId: company.id, approval });
      }
    })
  );

  return allPending;
}

export async function listApprovals(): Promise<void> {
  logger.header("Pending Approvals");

  const pending = await fetchAllPending();
  if (pending.length === 0) {
    logger.dim("No pending approvals.");
    return;
  }

  for (let i = 0; i < pending.length; i++) {
    formatApproval(pending[i]!.approval, i);
  }

  logger.blank();
  logger.dim(`${pending.length} approval(s) pending. Run: mammoth approve resolve`);
}

export async function resolveApproval(approvalId: string | undefined): Promise<void> {
  const pending = await fetchAllPending();

  if (pending.length === 0) {
    logger.info("No pending approvals.");
    return;
  }

  let target: { companyId: string; approval: PendingApproval } | undefined;

  if (approvalId) {
    target = pending.find((p) => p.approval.id === approvalId);
    if (!target) {
      logger.error(`Approval ${approvalId} not found or not pending.`);
      process.exit(1);
    }
  } else {
    // Interactive selection
    const choices = pending.map((p, i) => ({
      name: `#${i + 1} ${p.approval.actionType} — ${p.approval.department} ${ringBadge(p.approval.ringLevel)}`,
      value: i,
    }));

    const { selectedIdx } = await inquirer.prompt<{ selectedIdx: number }>([
      {
        type: "list",
        name: "selectedIdx",
        message: "Select approval to resolve:",
        choices,
      },
    ]);

    target = pending[selectedIdx];
  }

  if (!target) {
    logger.error("No approval selected.");
    process.exit(1);
  }

  formatApproval(target.approval, 0);
  logger.blank();

  const { action } = await inquirer.prompt<{ action: ResolveAction }>([
    {
      type: "list",
      name: "action",
      message: "Decision:",
      choices: [
        { name: "Approve — execute as proposed", value: "approved" },
        { name: "Reject — do not execute", value: "rejected" },
        { name: "Modify — edit content first", value: "modified" },
      ],
    },
  ]);

  let modifiedContent: string | undefined;
  if (action === "modified") {
    const { content } = await inquirer.prompt<{ content: string }>([
      {
        type: "editor",
        name: "content",
        message: "Edit the content:",
        default: target.approval.proposedContent,
      },
    ]);
    modifiedContent = content;
  }

  await apiClient.resolveApproval(
    target.companyId,
    target.approval.id,
    action,
    modifiedContent
  );

  const icons: Record<ResolveAction, string> = {
    approved: "Approved",
    rejected: "Rejected",
    modified: "Modified and approved",
  };

  logger.success(`${icons[action]}: ${target.approval.actionType}`);
}
