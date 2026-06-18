// Mirror of AgentJobData from @mammoth/agents — avoids circular dependency
// on the full agents package from the temporal worker.
export type AgentJobData = {
  companyId: string;
  departmentId: string;
  taskId: string;
  agentRunId: string;
  taskType: string;
  parameters: Record<string, unknown>;
};
