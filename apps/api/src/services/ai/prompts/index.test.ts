import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { AI_PROMPT_IDS, aiPrompt } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

test("every prompt file is registered, and every registered id has a file", () => {
  const files = readdirSync(here)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
  assert.deepEqual(files, [...AI_PROMPT_IDS].sort());
});

test("a prompt is one paragraph of rules, without its markdown scaffolding", () => {
  const chat = aiPrompt("ai-chat-turn.v1", { submitTool: "submit_answer" });
  assert.ok(!chat.includes("#"), "the heading is documentation, not instruction");
  assert.ok(!chat.includes("<!--"), "the authoring note never reaches the model");
  assert.ok(!chat.includes("\n"));
  assert.match(chat, /Souřadnice nikdy nevymýšlíš/u);
  assert.match(chat, /voláním nástroje submit_answer/u);
});

test("an unfilled placeholder is refused rather than sent to the model", () => {
  assert.throws(() => aiPrompt("ai-chat-turn.v1"), /submitTool/u);
});

test("every prompt says something and keeps its own rules", () => {
  for (const id of AI_PROMPT_IDS) {
    const text = aiPrompt(id, { submitTool: "submit_answer" });
    assert.ok(text.length > 80, `${id} is too short to be a system prompt`);
    assert.ok(!/\{\{/u.test(text), `${id} still has a placeholder`);
    assert.match(text, /česk/iu, `${id} does not say which language to answer in`);
  }
});
