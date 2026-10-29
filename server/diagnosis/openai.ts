import OpenAI from "openai";
import { diagnosisInstructions } from "./prompt";
import { DiagnosisUnavailableError, LIKELIHOODS, type DiagnosisProvider, type DiagnosisRequest } from "./types";

export const DEFAULT_DIAGNOSIS_MODEL = "gpt-6-luna";
export const OPENAI_MAX_RETRIES = 2;
export const OPENAI_TIMEOUT_MS = 30_000;
// Reasoning tokens count against this budget too.
export const OPENAI_MAX_OUTPUT_TOKENS = 3000;

// 429s that retrying cannot fix (library/server-tech.md §3).
const BILLING_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "billing_hard_limit_reached",
]);
const BILLING_TYPES = new Set(["insufficient_quota", "billing_error"]);

export const DIAGNOSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    causes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          likelihood: { type: "string", enum: [...LIKELIHOODS] },
          explanation: { type: "string" },
          advice: { type: "string" },
        },
        required: ["title", "likelihood", "explanation", "advice"],
      },
    },
    summary: { type: "string" },
  },
  required: ["causes", "summary"],
};

export function buildOpenAIRequest(model: string, input: DiagnosisRequest) {
  return {
    model,
    store: false,
    reasoning: { effort: "low" as const },
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    instructions: diagnosisInstructions(input.language, input.subject ?? "own"),
    input: [
      {
        role: "user" as const,
        content: [
          { type: "input_text" as const, text: input.context },
          { type: "input_image" as const, image_url: input.photoDataUrl, detail: "auto" as const },
        ],
      },
    ],
    text: {
      format: { type: "json_schema" as const, name: "plant_diagnosis", schema: DIAGNOSIS_JSON_SCHEMA, strict: true },
    },
  };
}

function isBillingError(error: { code?: unknown; type?: unknown } | null | undefined): boolean {
  if (!error) return false;
  return (typeof error.code === "string" && BILLING_CODES.has(error.code)) ||
    (typeof error.type === "string" && BILLING_TYPES.has(error.type));
}

/**
 * Wraps the transport the SDK uses: a billing 429 gets `x-should-retry: false` so the SDK's own retry loop
 * (maxRetries 2) stops after one attempt, and no attempt starts once the request signal has fired.
 */
export function guardedFetch(base: typeof fetch): typeof fetch {
  return (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    const response = await base(url, init);
    if (response.status !== 429) return response;
    const body = await response.text();
    let billing = false;
    try {
      billing = isBillingError(JSON.parse(body)?.error);
    } catch {
      billing = false;
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    if (billing) headers.set("x-should-retry", "false");
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }) as typeof fetch;
}

/** Fixed labels for logs; never the provider's error text. */
export function classifyOpenAIError(error: unknown): { reason: string; status?: number } {
  if (error instanceof OpenAI.APIUserAbortError) return { reason: "aborted" };
  if (error instanceof OpenAI.APIConnectionTimeoutError) return { reason: "timeout" };
  if (error instanceof OpenAI.APIConnectionError) return { reason: "network" };
  if (!(error instanceof OpenAI.APIError)) return { reason: "unexpected" };
  const status = typeof error.status === "number" ? error.status : undefined;
  if (isBillingError({ code: error.code, type: error.type })) return { reason: "billing", status };
  if (status === 429) return { reason: "rate_limit", status };
  if ((status ?? 0) >= 500) return { reason: "upstream_unavailable", status };
  return { reason: "request_or_auth", status };
}

export class OpenAIDiagnosisProvider implements DiagnosisProvider {
  readonly name = "openai";
  readonly client: OpenAI;

  constructor(readonly model: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.client = new OpenAI({
      apiKey,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: OPENAI_TIMEOUT_MS,
      fetch: guardedFetch(fetchImpl),
      // SDK debug logging would print request bodies, which carry the photo.
      logLevel: "off",
    });
  }

  async diagnose(input: DiagnosisRequest, opts: { signal: AbortSignal }): Promise<unknown> {
    let response: any;
    try {
      response = await this.client.responses.create(buildOpenAIRequest(this.model, input) as any, { signal: opts.signal });
    } catch (error) {
      const { reason, status } = classifyOpenAIError(error);
      throw new DiagnosisUnavailableError(reason, status);
    }
    if (response?.status !== "completed") throw new DiagnosisUnavailableError("incomplete");
    let refused = false;
    let text = "";
    for (const item of Array.isArray(response.output) ? response.output : []) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part?.type === "refusal") refused = true;
        else if (part?.type === "output_text" && typeof part.text === "string") text += part.text;
      }
    }
    if (refused) throw new DiagnosisUnavailableError("refusal");
    try {
      return JSON.parse(text);
    } catch {
      throw new DiagnosisUnavailableError("invalid_output");
    }
  }
}

export function createOpenAIDiagnosisProvider(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): OpenAIDiagnosisProvider {
  return new OpenAIDiagnosisProvider(opts.model || DEFAULT_DIAGNOSIS_MODEL, opts.apiKey, opts.fetch);
}
