/**
 * Versioned system prompts (§30.9).
 *
 * A prompt is a product decision — "cite the source", "never invent coordinates" — so it lives in
 * a reviewable file next to its version, not inline in the service that happens to send it. The
 * id is the `templateVersion` the gateway already records, so a telemetry row names the exact
 * text that produced it, and a new wording means a new file rather than an edit to an old one.
 *
 * The markdown is the prompt: headings and authoring notes are stripped, the remaining sentences
 * are joined into the single paragraph the providers expect.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type AiPromptId =
  | "ai-chat-turn.v1"
  | "ai-chat-turn.v2"
  | "guide-synthesis.v1"
  | "poi-brief.v1"
  | "plan-discussion.v1"
  | "region-digest.v1"
  | "geology-explanation.v1";

export const AI_PROMPT_IDS: readonly AiPromptId[] = [
  "ai-chat-turn.v1",
  "ai-chat-turn.v2",
  "guide-synthesis.v1",
  "poi-brief.v1",
  "plan-discussion.v1",
  "region-digest.v1",
  "geology-explanation.v1"
];

const here = dirname(fileURLToPath(import.meta.url));
// `tsc` leaves the markdown behind, so the built server reads it from `dist` when the build
// copied it and from `src` when it did not. Both paths are the same reviewed file.
const DIRECTORIES = [here, resolve(here, "../../../../src/services/ai/prompts")];

const cache = new Map<string, string>();

function readPromptFile(id: AiPromptId): string {
  for (const directory of DIRECTORIES) {
    try {
      return readFileSync(resolve(directory, `${id}.md`), "utf8");
    } catch {
      // Try the next location; a genuinely missing prompt is reported below.
    }
  }
  throw new Error(`AI prompt ${id} is missing`);
}

/** Markdown to prompt: drop the scaffolding, keep the rules, one paragraph. */
function toPrompt(markdown: string): string {
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/gu, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*]\s+/u, ""));
  return lines.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * The prompt text for `id`, with `{{placeholder}}` slots filled from `values`.
 *
 * A slot left unfilled throws: a prompt that reaches a provider with `{{submitTool}}` in it asks
 * the model to call a tool that does not exist, and the answer fails much further downstream.
 */
export function aiPrompt(id: AiPromptId, values: Readonly<Record<string, string>> = {}): string {
  const key = `${id}|${JSON.stringify(values)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const text = toPrompt(readPromptFile(id)).replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`AI prompt ${id} has no value for {{${name}}}`);
    return value;
  });
  if (!text) throw new Error(`AI prompt ${id} is empty`);
  cache.set(key, text);
  return text;
}
