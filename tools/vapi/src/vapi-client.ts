import { z } from "zod";
import { requireDispatchContext } from "@mammoth/shared/security";

const VAPI_BASE_URL = "https://api.vapi.ai";
const REQUEST_TIMEOUT_MS = 20_000;

const VapiCallResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  phoneNumberId: z.string().optional(),
  assistantId: z.string().optional(),
  createdAt: z.string(),
});

const VapiAssistantResponseSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  createdAt: z.string(),
});

export type VapiCallOptions = {
  /** Phone number to call in E.164 format (+14155551234) */
  toPhone: string;
  /** Vapi phone number ID to call from */
  fromPhoneId: string;
  /** Assistant configuration or assistant ID to use */
  assistantId?: string;
  /** Inline assistant config if no pre-built assistant */
  assistantConfig?: VapiAssistantConfig;
};

export type VapiAssistantConfig = {
  name: string;
  /** The opening message the assistant says first */
  firstMessage: string;
  /** System prompt for the AI */
  systemPrompt: string;
  /** Max call duration in seconds */
  maxDurationSeconds?: number;
  voiceProvider?: "playht" | "deepgram" | "eleven-labs";
  voiceId?: string;
};

export type VapiCallResult =
  | { initiated: true; callId: string }
  | { initiated: false; reason: string };

/**
 * Initiates an outbound AI voice call via Vapi.
 * Agents use this for follow-up calls, support callbacks, and prospect outreach.
 * Ring 3 action — explicit founder approval required before any call is placed.
 *
 * @param apiKey - Vapi API key
 * @param options - Call configuration including phone number and assistant
 */
export async function initiateVapiCall(
  apiKey: string,
  options: VapiCallOptions
): Promise<VapiCallResult> {
  requireDispatchContext();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      type: "outboundPhoneCall",
      phoneNumberId: options.fromPhoneId,
      customer: { number: options.toPhone },
    };

    if (options.assistantId) {
      body["assistantId"] = options.assistantId;
    } else if (options.assistantConfig) {
      body["assistant"] = buildAssistantPayload(options.assistantConfig);
    }

    const response = await fetch(`${VAPI_BASE_URL}/call/phone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { initiated: false, reason: `Vapi error ${response.status}: ${errorText}` };
    }

    const raw = await response.json();
    const parsed = VapiCallResponseSchema.parse(raw);

    return { initiated: true, callId: parsed.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Vapi error";
    return { initiated: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Creates a reusable Vapi assistant for a specific department use case.
 * Assistants are created once and reused across calls.
 *
 * @param apiKey - Vapi API key
 * @param config - Assistant configuration
 */
export async function createVapiAssistant(
  apiKey: string,
  config: VapiAssistantConfig
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${VAPI_BASE_URL}/assistant`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildAssistantPayload(config)),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const raw = await response.json();
    const parsed = VapiAssistantResponseSchema.parse(raw);
    return parsed.id;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAssistantPayload(config: VapiAssistantConfig): Record<string, unknown> {
  return {
    name: config.name,
    firstMessage: config.firstMessage,
    model: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      systemPrompt: config.systemPrompt,
    },
    voice: {
      provider: config.voiceProvider ?? "playht",
      voiceId: config.voiceId ?? "jennifer",
    },
    maxDurationSeconds: config.maxDurationSeconds ?? 300,
    silenceTimeoutSeconds: 30,
    endCallPhrases: ["goodbye", "bye", "thank you, goodbye"],
  };
}
