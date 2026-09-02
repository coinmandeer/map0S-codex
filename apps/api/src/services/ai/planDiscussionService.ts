import { createHash } from "node:crypto";
import { assertPlanDocumentV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import { askCml, type CmlAnswer } from "../cmlService.js";

export interface PlanDiscussionRequest {
  ownerUserId: string;
  plan: PlanDocumentV2;
  prompt: string;
  externalModelConsent: boolean;
  history?: readonly { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}

export interface PlanDiscussionAnswer extends CmlAnswer {
  disclosure: string;
}

const DISCLOSURE =
  "AI obdržela text dotazu, název plánu, pořadí, názvy a GPS zastávek a souhrn trasy. Poznámky, identita vlastníka a interní metadata odeslány nebyly.";
const HISTORY_DISCLOSURE =
  " AI obdržela také omezenou historii této konverzace, aby mohla navázat.";
const HISTORY_MESSAGE_LIMIT = 10;
const HISTORY_CHARACTER_LIMIT = 12_000;

function safePrompt(value: string): string | null {
  const prompt = value.trim();
  if (!prompt || prompt.length > 2_000) return null;
  for (let index = 0; index < prompt.length; index += 1) {
    const code = prompt.charCodeAt(index);
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return null;
  }
  return prompt;
}

export function projectPlanDiscussionHistory(
  history: PlanDiscussionRequest["history"]
): Array<{ role: "user" | "assistant"; content: string }> {
  const projected: Array<{ role: "user" | "assistant"; content: string }> = [];
  let remaining = HISTORY_CHARACTER_LIMIT;
  for (const message of (history ?? []).slice(-HISTORY_MESSAGE_LIMIT).reverse()) {
    const content = safePrompt(message.content);
    if (!content || remaining <= 0) continue;
    const bounded = content.slice(-remaining);
    projected.unshift({ role: message.role, content: bounded });
    remaining -= bounded.length;
  }
  return projected;
}

/** Deliberately omits notes, owner identity, conversation ids, annotations and arbitrary metadata. */
export function projectPlanForDiscussion(plan: PlanDocumentV2) {
  assertPlanDocumentV2(plan);
  return {
    id: plan.id,
    revision: plan.revision,
    name: plan.name,
    departureAt: plan.departureAt,
    timezone: plan.timezone,
    routePolicy: plan.routePolicy,
    vehicle: plan.vehicle
      ? {
          profile: plan.vehicle.profile,
          heightM: plan.vehicle.heightM,
          widthM: plan.vehicle.widthM,
          weightT: plan.vehicle.weightT
        }
      : null,
    stops: plan.stops.map((stop) => ({
      order: stop.order + 1,
      name: stop.name,
      longitude: stop.location.coordinates[0],
      latitude: stop.location.coordinates[1],
      dwellMinutes: stop.dwellMinutes,
      arrivalAt: stop.arrivalAt,
      departureAt: stop.departureAt
    })),
    segments: plan.segments.map((segment) => {
      const selected = segment.alternatives.find(
        (alternative) => alternative.id === segment.selectedAlternativeId
      );
      return {
        order: segment.order + 1,
        status: segment.status,
        provider: segment.provider,
        distanceM: selected?.distanceM ?? null,
        durationS: selected?.durationS ?? null,
        warnings: selected?.warnings ?? []
      };
    })
  };
}

export async function discussPlanWithCml(
  request: PlanDiscussionRequest
): Promise<PlanDiscussionAnswer | null> {
  const prompt = safePrompt(request.prompt);
  if (!prompt || !request.externalModelConsent) return null;
  if (request.plan.ownerId && request.plan.ownerId !== request.ownerUserId) return null;
  const projection = projectPlanForDiscussion(request.plan);
  const history = projectPlanDiscussionHistory(request.history);
  const requestDigest = createHash("sha256")
    .update(JSON.stringify({ prompt, history, projection }))
    .digest("hex");
  const answer = await askCml({
    // Source IDs enter the model envelope, so they contain only a digest—not prompt or identity.
    cacheKey: `plan-discussion:${requestDigest}`,
    permissionPartition: `user:${request.ownerUserId}`,
    accountPrivateConsent: true,
    system: [
      "Jsi MapOS plánovací asistent. Odpovídej česky, stručně a prakticky.",
      "Pracuj pouze s dodaným plánem a dotazem. Pokud něco v datech není, řekni to.",
      "Pokud je přiložena historie konverzace, přirozeně na ni navazuj a neopakuj už vyřešené body.",
      "Nenahlašuj změnu plánu jako provedenou; můžeš pouze navrhnout další ruční krok.",
      "Nevymýšlej aktuální provoz, počasí, ceny ani otevírací dobu bez zdroje."
    ].join(" "),
    prompt: JSON.stringify({
      conversationHistory: history,
      userQuestion: prompt,
      plan: projection
    }),
    maxTokens: 900,
    temperature: 0.25,
    ttlMs: 10 * 60_000,
    signal: request.signal
  });
  return answer
    ? { ...answer, disclosure: `${DISCLOSURE}${history.length ? HISTORY_DISCLOSURE : ""}` }
    : null;
}
