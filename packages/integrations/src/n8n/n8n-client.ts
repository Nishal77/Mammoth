const N8N_TIMEOUT_MS = 10_000;

export type OutboundWebhookPayload = {
  event: string;
  companyId: string;
  department: string;
  actionType: string;
  approvalId: string;
  outputContent: string;
  timestamp: string;
};

export type WebhookResult = {
  fired: boolean;
  statusCode?: number;
  reason?: string;
};

/**
 * Fires an outbound webhook to an N8N (or any HTTP) endpoint.
 * Used after an approved action is dispatched — allows external automation
 * workflows to react to MAMMOTH agent actions.
 *
 * @param webhookUrl  - The N8N webhook URL (stored in integrations.metadata.webhookUrl)
 * @param payload     - The event payload
 */
export async function fireOutboundWebhook(
  webhookUrl: string,
  payload: OutboundWebhookPayload
): Promise<WebhookResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        fired: false,
        statusCode: response.status,
        reason: `Webhook returned ${response.status}`,
      };
    }

    return { fired: true, statusCode: response.status };
  } catch (error) {
    clearTimeout(timeoutId);
    const reason = error instanceof Error ? error.message : "Unknown error";
    return { fired: false, reason };
  }
}

/**
 * Validates that a webhook URL is a well-formed HTTPS endpoint.
 * Prevents accidental misconfiguration pointing to internal endpoints.
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
