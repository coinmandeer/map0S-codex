/**
 * `web_search` and `web_fetch` (§30.2).
 *
 * No model has the web built in; the web is our tool. Both calls go to Ollama's endpoints with the
 * same key the models use, through the shared upstream client so they inherit its timeouts,
 * per-provider circuit breaker, byte ceiling and cache. Results are trimmed and truncated here
 * rather than in the prompt, so a page that decides to be a megabyte long cannot spend the whole
 * context window.
 *
 * Without a key the tools are simply not composed: an assistant that says it looked something up
 * and did not is worse than one that says it cannot.
 */

import { config } from "../../config.js";
import { fetchJson } from "../../utils/upstream.js";
import type { AiToolExecutionContext } from "./toolRegistry.js";

const SEARCH_URL = "https://ollama.com/api/web_search";
const FETCH_URL = "https://ollama.com/api/web_fetch";
const MAX_RESULTS = 5;
const MAX_EXCERPT_CHARS = 600;
const MAX_PAGE_CHARS = 6_000;

export interface AiWebSearchResult {
  title: string;
  url: string;
  excerpt: string;
}

export interface AiWebPage {
  url: string;
  title?: string;
  text: string;
}

export interface AiWebTools {
  search(
    input: { query: string; maxResults?: number },
    context: AiToolExecutionContext
  ): Promise<{ results: AiWebSearchResult[] }>;
  fetch(input: { url: string }, context: AiToolExecutionContext): Promise<AiWebPage>;
}

interface SearchEnvelope {
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
}

interface FetchEnvelope {
  title?: unknown;
  content?: unknown;
  links?: unknown;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, limit) : "";
}

/** A result is only usable if it can be cited, and only an http(s) URL can be cited. */
function citableUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Production web tools, or `null` when the deployment has no key for them. */
export function createOllamaWebTools(): AiWebTools | null {
  if (!config.ollamaWebToolsEnabled || !config.ollamaKey) return null;
  const headers = {
    authorization: `Bearer ${config.ollamaKey}`,
    "content-type": "application/json"
  };

  return {
    async search(input, context) {
      context.signal.throwIfAborted();
      const query = input.query.trim().slice(0, 500);
      if (!query) return { results: [] };
      const maxResults = Math.min(MAX_RESULTS, Math.max(1, Math.floor(input.maxResults ?? 3)));
      const envelope = await fetchJson<SearchEnvelope>(SEARCH_URL, {
        providerId: "ollama-web-search",
        method: "POST",
        body: JSON.stringify({ query, max_results: maxResults }),
        headers,
        timeoutMs: 8_000,
        // The same question asked twice in one conversation is common; the web is not that fresh.
        ttlMs: 30 * 60_000,
        maxResponseBytes: 512 * 1024,
        signal: context.signal
      });
      const results: AiWebSearchResult[] = [];
      for (const entry of envelope.results ?? []) {
        const url = citableUrl(entry?.url);
        const title = text(entry?.title, 200);
        if (!url || !title) continue;
        results.push({ title, url, excerpt: text(entry?.content, MAX_EXCERPT_CHARS) });
        if (results.length >= maxResults) break;
      }
      return { results };
    },

    async fetch(input, context) {
      context.signal.throwIfAborted();
      const url = citableUrl(input.url);
      if (!url) throw new Error("web_fetch requires an http(s) URL");
      const envelope = await fetchJson<FetchEnvelope>(FETCH_URL, {
        providerId: "ollama-web-fetch",
        method: "POST",
        body: JSON.stringify({ url }),
        headers,
        timeoutMs: 10_000,
        ttlMs: 6 * 3600_000,
        maxResponseBytes: 2 * 1024 * 1024,
        signal: context.signal
      });
      const title = text(envelope.title, 200);
      return {
        url,
        ...(title ? { title } : {}),
        text: text(envelope.content, MAX_PAGE_CHARS)
      };
    }
  };
}

/** Offline: labelled fixtures, so the tool exists on the memory server without public I/O. */
export function createFixtureWebTools(
  pages: readonly (AiWebPage & { excerpt?: string })[]
): AiWebTools {
  return {
    async search(input, context) {
      context.signal.throwIfAborted();
      const needle = input.query.trim().toLocaleLowerCase("cs-CZ");
      return {
        results: pages
          .filter(
            (page) =>
              !needle ||
              page.text.toLocaleLowerCase("cs-CZ").includes(needle) ||
              (page.title ?? "").toLocaleLowerCase("cs-CZ").includes(needle)
          )
          .slice(0, Math.max(1, Math.floor(input.maxResults ?? 3)))
          .map((page) => ({
            title: page.title ?? page.url,
            url: page.url,
            excerpt: page.excerpt ?? page.text.slice(0, MAX_EXCERPT_CHARS)
          }))
      };
    },
    async fetch(input, context) {
      context.signal.throwIfAborted();
      const page = pages.find((candidate) => candidate.url === input.url);
      if (!page) throw new Error("web_fetch fixture has no such page");
      return page;
    }
  };
}
