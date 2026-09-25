import type { AiConversation } from "./conversation.js";
import type { HistoryTurn } from "./chatHistory.js";
/** Only migrate the preserved raw tail. A compacted summary is not a recovered transcript. */
export function legacyHistoryTurns(document: AiConversation): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  const blank = (id: string, at: string): HistoryTurn => ({
    id,
    requestedAt: at,
    question: "",
    text: "",
    cards: [],
    sources: [],
    followUps: [],
    done: true,
    error: null,
    step: null,
    scopeKey: "",
    scopeLabel: "Převedená starší historie"
  });
  if (document.compaction?.compactedMessageCount)
    turns.push({
      ...blank(`legacy-note:${document.id}`, document.createdAt),
      question: "Dochovaná historie",
      text: "Starší systém uchovával pouze poslední zprávy. Dřívější část konverzace není úplně dochovaná; mapová scéna nebyla uložená."
    });
  for (const message of document.messages) {
    if (message.role === "tool") continue;
    if (message.role === "user")
      turns.push({
        ...blank(`legacy:${message.id}`, message.createdAt),
        question: message.content
      });
    else {
      let last = turns.at(-1);
      if (!last || last.text) {
        last = {
          ...blank(`legacy:${message.id}`, message.createdAt),
          question: "Dochovaná odpověď"
        };
        turns.push(last);
      }
      last.text = message.content;
      last.sources = message.citations;
    }
  }
  return turns;
}
