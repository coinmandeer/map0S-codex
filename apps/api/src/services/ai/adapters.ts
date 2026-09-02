import type {
  AiAdapterRequest,
  AiAdapterResult,
  AiModelAdapter,
  AiModelProfile
} from "./contracts.js";
import { assertProviderId } from "../../observability/providerCircuitBreaker.js";
import { fetchJson } from "../../utils/upstream.js";

const DISABLED_CAPABILITIES: AiModelProfile["capabilities"] = {
  text: false,
  jsonSchema: false,
  tools: false,
  streaming: false,
  vision: false
};

export class DisabledAiAdapter implements AiModelAdapter {
  readonly id = "disabled";
  readonly capabilities = DISABLED_CAPABILITIES;

  async run(_request: AiAdapterRequest, _signal: AbortSignal): Promise<AiAdapterResult> {
    throw new AiAdapterUnavailableError();
  }
}

export class AiAdapterUnavailableError extends Error {
  constructor() {
    super("AI adapter unavailable");
    this.name = "AiAdapterUnavailableError";
  }
}

export class AiAdapterResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAdapterResponseError";
  }
}

interface OpenAiCompatibleAdapterOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

interface ChatCompletionEnvelope {
  id?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new AiAdapterResponseError("AI provider returned a non-JSON response");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiAdapterResponseError("AI provider response exceeded the byte limit");
  }
  if (!response.body) throw new AiAdapterResponseError("AI provider returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new AiAdapterResponseError("AI provider response exceeded the byte limit");
    }
    chunks.push(chunk.value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    throw new AiAdapterResponseError("AI provider returned malformed JSON");
  }
}

function finishReason(value: string | undefined): AiAdapterResult["finishReason"] {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "content_filter") return "content-filter";
  if (value === "tool_calls") return "tool-call";
  return "unknown";
}

/** Minimal OpenAI-compatible transport. Policy, cache, timeout and output validation stay in the
 * gateway; this adapter only normalises one provider response and never exposes its raw payload. */
export class OpenAiCompatibleAdapter implements AiModelAdapter {
  readonly capabilities: AiModelProfile["capabilities"] = {
    text: true,
    jsonSchema: true,
    tools: false,
    streaming: false,
    vision: false
  };
  readonly id: string;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly providerId: string;
  private readonly request?: typeof fetch;

  constructor(options: OpenAiCompatibleAdapterOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/$/, "");
    if (!/^https:\/\//i.test(baseUrl)) throw new Error("AI provider URL must use HTTPS");
    if (!options.apiKey.trim()) throw new Error("AI provider key is required");
    if (!options.model.trim()) throw new Error("AI model is required");
    this.id = options.id;
    this.url = `${baseUrl}/chat/completions`;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.providerId = assertProviderId(`ai-${options.id}`);
    this.request = options.fetch;
  }

  async run(request: AiAdapterRequest, signal: AbortSignal): Promise<AiAdapterResult> {
    const body = JSON.stringify({
      model: this.model,
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt }
      ],
      ...(request.outputSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.taskId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 64),
                strict: true,
                schema: request.outputSchema
              }
            }
          }
        : {})
    });
    let envelope: ChatCompletionEnvelope;
    if (this.request) {
      const response = await this.request(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body,
        signal
      });
      if (!response.ok) throw new AiAdapterResponseError(`AI provider HTTP ${response.status}`);
      envelope = (await readBoundedJson(
        response,
        request.maxResponseBytes
      )) as ChatCompletionEnvelope;
    } else {
      envelope = await fetchJson<ChatCompletionEnvelope>(this.url, {
        providerId: this.providerId,
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body,
        signal,
        ttlMs: 0,
        timeoutMs: 30_000,
        maxResponseBytes: request.maxResponseBytes
      });
    }
    const choice = envelope?.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) throw new AiAdapterResponseError("AI provider returned no answer");
    return {
      text,
      finishReason: finishReason(choice?.finish_reason),
      providerRequestId: envelope?.id,
      usage: {
        inputTokens: envelope?.usage?.prompt_tokens,
        outputTokens: envelope?.usage?.completion_tokens
      }
    };
  }
}
