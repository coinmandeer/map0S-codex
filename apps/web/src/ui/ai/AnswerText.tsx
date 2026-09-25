import type { ReactNode } from "react";

/**
 * The assistant's answer as paragraphs, lists and bold — and nothing else.
 *
 * Models write light Markdown whether asked to or not. Rendering it as one `<p>` turned a list of
 * places into a wall of text with asterisks in it; rendering it as HTML would let a web page the
 * model quoted inject markup. This parses the three things answers actually use into React
 * elements, so any other character stays text.
 */

const LIST_ITEM = /^\s*(?:[-*•–]|(\d{1,2})[.)])\s+(.*)$/u;

function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/gu);
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) =>
      /^\*\*[^*]+\*\*$/u.test(part) ? (
        <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>
      ) : (
        part.replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$)/gu, "$1$2")
      )
    );
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] });
      continue;
    }
    const item = line.match(LIST_ITEM);
    const last = out.at(-1);
    if (item) {
      const ordered = item[1] !== undefined;
      if (last && last.kind === (ordered ? "ol" : "ul")) last.items.push(item[2]!);
      else if (ordered) out.push({ kind: "ol", items: [item[2]!], start: Number(item[1]) });
      else out.push({ kind: "ul", items: [item[2]!] });
      continue;
    }
    if (last?.kind === "p" && last.lines.length) last.lines.push(line.trim());
    else out.push({ kind: "p", lines: [line.trim().replace(/^#{1,6}\s+/u, "")] });
  }
  return out.filter((block) => (block.kind === "p" ? block.lines.length > 0 : true));
}

export function AnswerText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="ai-turn-answer" data-testid="ai-turn-answer">
      {blocks(text).map((block, index) => {
        const key = `b${index}`;
        if (block.kind === "ul")
          return (
            <ul key={key}>
              {block.items.map((item, position) => (
                <li key={position}>{inline(item, `${key}-${position}`)}</li>
              ))}
            </ul>
          );
        if (block.kind === "ol")
          return (
            <ol key={key} start={block.start}>
              {block.items.map((item, position) => (
                <li key={position}>{inline(item, `${key}-${position}`)}</li>
              ))}
            </ol>
          );
        return (
          <p key={key}>
            {block.lines.flatMap((line, position) => [
              ...(position ? [<br key={`${key}-br${position}`} />] : []),
              ...inline(line, `${key}-${position}`)
            ])}
          </p>
        );
      })}
    </div>
  );
}
