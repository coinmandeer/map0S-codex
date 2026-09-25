import { planCommandFromEdits } from "./planEditor.js";
import type { AiChatPlanEdit } from "./chatService.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";
import { randomUUID } from "node:crypto";
import {
  applyPlanCommand,
  normalizeCatalogText,
  type PlanCommandV2,
  type PlanDocumentV2
} from "@mapos/layer-sdk";

export function editDraftInstruction(
  draft: PlanDocumentV2,
  message: string
): { plan?: PlanDocumentV2; text: string } | null {
  const query = normalizeCatalogText(message);
  let command: PlanCommandV2 | undefined;
  let text = "Upravuji pracovní verzi plánu. Uložený plán se nezměnil.";
  const rename = message.match(
    /^(?:přejmenuj|prejmenuj|rename)(?:\s+(?:plán|plan))?\s+(?:na\s+|to\s+)?(.+)$/iu
  );
  if (rename) {
    const name = rename[1]!
      .trim()
      .replace(/^[„"']|[“"']$/g, "")
      .slice(0, 120);
    if (!name) return null;
    command = { type: "update-plan", patch: { name } };
    text = `Pracovní plán se jmenuje „${name}“.`;
  } else if (
    /^(?:zmen|preved|prepni|change|switch)\b/.test(query) &&
    /\b(?:pesky|pesi|foot|walk|bike|bicycle|kolo|kole|cyklisticky|auto|autem|car)\b/.test(query)
  ) {
    const profile = /\b(?:bike|bicycle|kolo|kole|cyklisticky)\b/.test(query)
      ? "bike"
      : /\b(?:auto|autem|car)\b/.test(query)
        ? "car"
        : "foot";
    command = {
      type: "batch",
      commands: [
        { type: "replace-vehicle", vehicle: null },
        { type: "replace-route-policy", routePolicy: { ...draft.routePolicy, profile } }
      ]
    };
    text = `Přepočítávám pracovní trasu ${profile === "bike" ? "na kole" : profile === "car" ? "autem" : "pěšky"}. Zastávky a jejich pořadí zachovávám.`;
  } else {
    const remove = query.match(/^(?:odeber|vynech|remove|delete)\s+(?:(?:zastavku|stop)\s+)?(.+)$/);
    const move = query.match(
      /^(?:presun|premisti|move)\s+(?:(?:zastavku|stop)\s+)?(.+?)\s+(?:na pozici|na misto|to position)\s+(\d+)$/
    );
    const target = (remove?.[1] ?? move?.[1])?.replace(/[.!?]$/, "").trim();
    if (!target) return null;
    const ordinal = /^\d+$/.test(target) ? Number(target) - 1 : null;
    const matches = draft.stops.filter((stop, index) =>
      ordinal !== null ? index === ordinal : normalizeCatalogText(stop.name) === target
    );
    if (matches.length !== 1)
      return {
        text: "Zastávku nelze jednoznačně určit. Použij její přesný název nebo číslo v seznamu."
      };
    const stop = matches[0]!,
      index = draft.stops.findIndex((s) => s.id === stop.id);
    if (stop.locked || index === 0 || index === draft.stops.length - 1)
      return {
        text: "Start, cíl a zamčené zastávky zůstávají pevné. Vybranou zastávku nejprve uprav v plánovači."
      };
    if (remove) command = { type: "remove-stop", stopId: stop.id };
    if (move) {
      const toIndex = Number(move[2]) - 1;
      if (toIndex < 1 || toIndex >= draft.stops.length - 1)
        return { text: "Zastávku lze přesunout jen mezi pevný start a cíl." };
      if (
        draft.stops
          .slice(Math.min(index, toIndex), Math.max(index, toIndex) + 1)
          .some((s) => s.locked)
      )
        return {
          text: "Přesun by změnil pořadí vůči zamčené zastávce. Návrh ponechávám beze změny."
        };
      command = { type: "move-stop", stopId: stop.id, toIndex };
    }
  }
  if (!command) return null;
  const result = applyPlanCommand(draft, {
    id: randomUUID(),
    expectedRevision: draft.revision,
    command
  });
  return { plan: result.plan, text };
}

/** Atomic model edits of the supplied working copy; never writes a saved plan. */
export function editDraftFromModel(
  draft: PlanDocumentV2,
  edits: readonly AiChatPlanEdit[],
  places: readonly AiPlaceSearchRecord[]
): PlanDocumentV2 {
  if (!edits.length || edits.length > 20 || draft.stops.length < 2)
    throw new Error("Invalid draft edit");
  let preview = draft;
  const commands: PlanCommandV2[] = [];
  for (const requested of edits) {
    const edit = { ...requested };
    if (edit.op === "add-stop") {
      edit.atIndex ??= preview.stops.length - 1;
      if (
        !Number.isInteger(edit.atIndex) ||
        edit.atIndex < 1 ||
        edit.atIndex >= preview.stops.length ||
        preview.stops.length >= 40 ||
        !places.some((place) => place.id === edit.placeId)
      )
        throw new Error("Unverified place or protected endpoint");
    } else if (edit.op === "remove-stop" || edit.op === "move-stop") {
      const index = preview.stops.findIndex((stop) => stop.id === edit.stopId);
      if (index <= 0 || index >= preview.stops.length - 1 || preview.stops[index]!.locked)
        throw new Error("Protected or unknown stop");
      if (edit.op === "move-stop") {
        const target = edit.toIndex;
        if (
          target === undefined ||
          !Number.isInteger(target) ||
          target < 1 ||
          target >= preview.stops.length - 1 ||
          preview.stops
            .slice(Math.min(index, target), Math.max(index, target) + 1)
            .some((stop) => stop.locked)
        )
          throw new Error("Protected stop order");
      }
    } else if (edit.op !== "rename-plan" || !edit.name?.trim()) throw new Error("Unsupported edit");
    const command = planCommandFromEdits({ plan: preview, edits: [edit], places });
    preview = applyPlanCommand(preview, {
      id: randomUUID(),
      expectedRevision: preview.revision,
      command
    }).plan;
    commands.push(command);
  }
  return applyPlanCommand(draft, {
    id: randomUUID(),
    expectedRevision: draft.revision,
    command: { type: "batch", commands }
  }).plan;
}
