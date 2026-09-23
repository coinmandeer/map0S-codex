import {
  overviewSections,
  validatedSynthesis,
  mergeSynthesisSections
} from "./overviewSections.js";

import { createHash, randomUUID } from "node:crypto";
import type {
  AreaSelection,
  EvidenceItem,
  OverviewEvent,
  OverviewRequest,
  OverviewResult
} from "@mapos/layer-sdk";
import type { sourcePlaceDetail } from "./sourceDetail.js";

export const overviewHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface OverviewContext {
  ownerUserId: string;
  permissionRevision: string;
  allowedLayerIds: ReadonlySet<string>;
}
export interface OverviewDependencies {
  detail: typeof sourcePlaceDetail;
  area?: (id: string, revision: string) => Promise<AreaSelection | null>;
  collect?: (
    input: OverviewRequest,
    evidence: EvidenceItem[],
    signal: AbortSignal,
    publish: (items: EvidenceItem[]) => void
  ) => Promise<void>;
  synthesize?: (
    input: OverviewRequest,
    evidence: EvidenceItem[],
    owner: string,
    signal: AbortSignal
  ) => Promise<
    string[] | { sections: { id: string; claims: { evidenceId: string; quote: string }[] }[] }
  >;
  synthesisAvailable?: () => Promise<boolean>;
  deadlineMs?: number;
}
interface Run {
  controller: AbortController;
  listeners: Set<(event: OverviewEvent) => void>;
  last?: OverviewEvent;
  finished: Promise<void>;
}
/** Shared acquisition, not just a cache after the expensive work. Cache partitions include the
 * server ACL revision. Every subscriber must pass authorization before any cached data is read. */
export class OverviewService {
  private runs = new Map<string, Run>();
  private cache = new Map<
    string,
    {
      result: OverviewResult;
      expires: number;
      owner: string;
      input: OverviewRequest;
      factsKey: string;
      factsComplete: boolean;
    }
  >();
  private users = new Set<string>();
  constructor(private deps: OverviewDependencies) {}
  getOwnedSnapshot(owner: string, fingerprint: string, allowed: ReadonlySet<string>) {
    const entry = this.cache.get(fingerprint);
    if (
      !entry ||
      entry.owner !== owner ||
      entry.expires <= Date.now() ||
      (entry.input.target.type === "poi" && !allowed.has(entry.input.target.layerId))
    )
      return null;
    return { recipe: structuredClone(entry.input), result: structuredClone(entry.result) };
  }
  async run(
    input: OverviewRequest,
    context: OverviewContext,
    signal: AbortSignal,
    publish: (event: OverviewEvent) => void
  ): Promise<void> {
    signal.throwIfAborted();
    if (
      input.target.type === "poi" &&
      (!context.allowedLayerIds.has(input.target.layerId) ||
        input.target.layerId.startsWith("ai-answer-"))
    )
      throw new Error("Vrstva cíle není dostupná.");
    const targetKey = overviewHash(input.target);
    const fingerprint = overviewHash([
      { ...input, refresh: undefined },
      context.ownerUserId,
      context.permissionRevision,
      [...context.allowedLayerIds].sort()
    ]);
    const factsKey = overviewHash([
      { ...input, intent: undefined, refresh: undefined },
      context.ownerUserId,
      context.permissionRevision,
      [...context.allowedLayerIds].sort()
    ]);
    const reusable = !input.refresh
      ? [...this.cache.values()].find(
          (entry) =>
            entry.factsKey === factsKey && entry.factsComplete && entry.expires > Date.now()
        )?.result
      : undefined;
    const key = fingerprint;
    const requestId = randomUUID();
    const deliver = (event: OverviewEvent) => {
      if (!signal.aborted) publish({ ...event, requestId });
    };
    const cached = !input.refresh && this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      deliver({
        type: cached.result.status as "complete" | "partial",
        requestId,
        runId: randomUUID(),
        targetKey,
        scopeFingerprint: fingerprint,
        seq: 1,
        revision: cached.result.revision,
        snapshot: structuredClone(cached.result)
      });
      return;
    }
    let run = this.runs.get(key);
    if (!run) {
      if (this.users.has(context.ownerUserId))
        throw new Error("Jeden přehled už běží. Zastavte ho nebo počkejte.");
      if (this.runs.size >= 10) throw new Error("Fronta přehledů je plná. Zkuste to za chvíli.");
      this.users.add(context.ownerUserId);
      run = {
        controller: new AbortController(),
        listeners: new Set(),
        finished: Promise.resolve()
      };
      this.runs.set(key, run);
      const current = run;
      current.finished = Promise.resolve()
        .then(() =>
          this.execute(input, context, targetKey, fingerprint, current, factsKey, reusable)
        )
        .finally(() => {
          this.runs.delete(key);
          this.users.delete(context.ownerUserId);
        });
    }
    const active = run;
    active.listeners.add(deliver);
    if (active.last) deliver(active.last);
    let releaseAbort: (() => void) | undefined;
    const disconnected = new Promise<void>((resolve) => {
      releaseAbort = () => {
        active.listeners.delete(deliver);
        if (!active.listeners.size) active.controller.abort();
        resolve();
      };
      signal.addEventListener("abort", releaseAbort, { once: true });
    });
    try {
      await Promise.race([active.finished, disconnected]);
    } finally {
      if (releaseAbort) signal.removeEventListener("abort", releaseAbort);
      active.listeners.delete(deliver);
      if (!active.listeners.size) active.controller.abort();
    }
  }
  private async execute(
    input: OverviewRequest,
    context: OverviewContext,
    targetKey: string,
    fingerprint: string,
    run: Run,
    factsKey: string,
    reusable?: OverviewResult
  ) {
    const runId = randomUUID();
    let seq = 0;
    const result: OverviewResult = {
      targetKey,
      scopeFingerprint: fingerprint,
      revision: 0,
      geometryRevision: "empty",
      composition: "facts",
      status: "loading",
      sections: [],
      sources: [],
      mapRefs: [],
      limitations: []
    };
    // Candidate documents are only links in the UI. Keep their full text server-side;
    // repeatedly sending it with each progress event adds bytes without helping the reader.
    const snapshot = (): OverviewResult => ({
      ...structuredClone(result),
      sources: result.sources.map((source) =>
        source.kind === "document" ? { ...source, text: "" } : { ...source }
      )
    });
    const send = (type: OverviewEvent["type"], phase?: string) => {
      result.revision++;
      const event: OverviewEvent = {
        type,
        requestId: runId,
        runId,
        targetKey,
        scopeFingerprint: fingerprint,
        seq: ++seq,
        revision: result.revision,
        ...(phase ? { phase } : {}),
        snapshot: snapshot()
      };
      run.last = event;
      for (const listener of run.listeners) {
        try {
          listener(event);
        } catch {
          /* a broken subscriber cannot block other subscribers */
        }
      }
    };
    let accepting = true;
    let factsComplete = false;
    const add = (items: EvidenceItem[]) => {
      if (!accepting || run.controller.signal.aborted) return;
      const previousSourceCount = result.sources.length;
      for (const item of items)
        if (result.sources.length < 40 && !result.sources.some((old) => old.id === item.id))
          result.sources.push(item);
      if (result.sources.length === previousSourceCount) return;
      result.sections = overviewSections(result.sources);
      const refs = result.sources
        .filter(
          (e) =>
            e.place &&
            e.kind === "fact" &&
            e.access === "public" &&
            !e.place.layerId.startsWith("ai-answer-")
        )
        .map((e) => ({ ...e.place!, evidenceIds: [e.id] }));
      if (refs.length) {
        result.mapRefs = [
          ...new Map(
            [...result.mapRefs, ...refs].map((ref) => [
              JSON.stringify([ref.layerId, ref.featureId]),
              ref
            ])
          ).values()
        ].slice(0, 100);
        result.geometryRevision = overviewHash(result.mapRefs);
      }
      send("section_upsert");
    };
    const evidence = (
      id: string,
      label: string,
      text: string,
      providerId: string,
      url?: string,
      sourceRecordId = id
    ): EvidenceItem => ({
      id,
      sourceRecordId,
      providerId,
      label,
      text: text.slice(0, 6000),
      ...(url ? { url } : {}),
      relation: "same_entity",
      topic: "identity",
      kind: "fact",
      retrievedAt: new Date().toISOString(),
      cacheUntil: new Date(Date.now() + 3600000).toISOString(),
      originGroup: providerId,
      access: "public"
    });
    const startedAt = Date.now();
    send("context_ready", "Ověřuji identitu a dostupné podklady");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        run.controller.abort();
        reject(new Error("Vypršel čas pro doplnění přehledu."));
      }, this.deps.deadlineMs ?? 25000);
    });
    try {
      await Promise.race([
        deadline,
        (async () => {
          const target = input.target;
          if (target.type === "coordinate") {
            add([
              evidence(
                "coordinate",
                "Vybraný bod",
                `Souřadnice: ${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}. Identita místa zatím není ověřená.`,
                "mapos"
              )
            ]);
            result.limitations.push("Nejbližší podnik není identitou vybraného bodu.");
          } else if (target.type === "poi") {
            const detail = await this.deps.detail(target, run.controller.signal);
            run.controller.signal.throwIfAborted();
            const items = Object.entries(detail.fields)
              .filter(([field]) => !["lng", "lat"].includes(field))
              .map(([field, value]) =>
                evidence(
                  `${detail.source.sourceId}:${field}`,
                  detail.source.label,
                  `${({ name: "Název", category: "Kategorie", description: "Popis", address: "Adresa", openingHours: "Otevírací doba", website: "Web", elevationM: "Nadmořská výška (m)", wikidata: "Wikidata" } as Record<string, string>)[field] ?? field}: ${String(value).slice(0, 2000)}`,
                  detail.source.providerId,
                  detail.source.url,
                  target.featureId
                )
              );
            add(items);
            result.mapRefs = [
              {
                layerId: target.layerId,
                featureId: target.featureId,
                title: detail.place.name,
                lng: detail.place.lng,
                lat: detail.place.lat,
                evidenceIds: items.slice(0, 1).map((e) => e.id)
              }
            ];
            result.geometryRevision = overviewHash(result.mapRefs);
            send("sources_ready");
          } else if (target.type === "area") {
            const area = await this.deps.area?.(target.areaId, target.boundaryRevision);
            run.controller.signal.throwIfAborted();
            if (!area) throw new Error("Vydání oblasti není dostupné. Obnovte výběr oblasti.");
            add([
              evidence(
                `area:${overviewHash([area.id, area.revision])}:name`,
                area.name,
                `${area.name} · ${area.level === "lau" ? "obec" : area.level === "country" ? "stát" : "správní oblast"} · ${area.country}.`,
                area.source
              )
            ]);
            result.limitations.push(
              "Počty z lokálního indexu nejsou úplným pokrytím oblasti. Údaje za širší statistický region nejsou místním měřením."
            );
          } else {
            add([
              evidence(
                "viewport",
                "Výřez mapy",
                `Vybraný výřez: ${target.bbox.join(", ")}.`,
                "mapos"
              )
            ]);
            result.limitations.push(
              "Výřez není administrativní oblast. Souhrnné počty zatím nejsou dostupné."
            );
          }
          if (reusable) {
            add(reusable.sources);
            factsComplete = true;
          }
          if (this.deps.collect && !reusable) {
            send("phase", "Základní informace připravené · doplňuji zdroje");
            const collectorSignal = AbortSignal.any([
              run.controller.signal,
              AbortSignal.timeout(Math.max(1, 12000 - (Date.now() - startedAt)))
            ]);
            try {
              await this.deps.collect(input, result.sources, collectorSignal, add);
              factsComplete = true;
            } catch (error) {
              if (!accepting) return;
              result.limitations.push(
                error instanceof Error ? error.message : "Část zdrojů se nepodařilo načíst."
              );
            }
          }
          if (input.consent.externalModel && this.deps.synthesize && result.sources.length > 1) {
            if (this.deps.synthesisAvailable && !(await this.deps.synthesisAvailable())) {
              result.limitations.push(
                "Modelový souhrn není aktivovaný; přehled používá dostupná zdrojová data."
              );
              return;
            }
            run.controller.signal.throwIfAborted();
            send("phase", "Podklady připravené · sestavuji souhrn");
            try {
              const ids = await this.deps.synthesize(
                input,
                result.sources,
                context.ownerUserId,
                run.controller.signal
              );
              run.controller.signal.throwIfAborted();
              const output = Array.isArray(ids)
                ? {
                    sections: [
                      {
                        id: "summary",
                        claims: ids.map((id) => ({
                          evidenceId: id,
                          quote: result.sources.find((e) => e.id === id)?.text
                        }))
                      }
                    ]
                  }
                : ids;
              const sections = validatedSynthesis(output, result.sources);
              result.sections = mergeSynthesisSections(sections, result.sections);
              result.composition = "model-assisted";
            } catch (error) {
              if (!accepting) return;
              result.limitations.push(
                error instanceof Error
                  ? error.message
                  : "Model není dostupný; zůstávají ověřená fakta."
              );
            }
          }
        })()
      ]);
      result.status = result.sources.length
        ? result.limitations.length
          ? "partial"
          : "complete"
        : "insufficient_evidence";
    } catch (error) {
      result.limitations.push(
        run.controller.signal.aborted
          ? "Doplňování bylo přerušeno. Získané podklady zůstávají."
          : error instanceof Error
            ? error.message
            : "Zdroj není dostupný."
      );
      result.status = result.sources.length ? "partial" : "insufficient_evidence";
    } finally {
      accepting = false;
      if (timeout) clearTimeout(timeout);
    }
    send(result.status as "complete" | "partial" | "insufficient_evidence");
    if (!run.controller.signal.aborted && result.sources.length) {
      const expires = Math.min(
        Date.now() + 3600000,
        ...result.sources.map((e) =>
          Math.min(
            e.validUntil ? Date.parse(e.validUntil) : Infinity,
            e.cacheUntil ? Date.parse(e.cacheUntil) : Date.now() + 3600000
          )
        )
      );
      this.cache.delete(fingerprint);
      this.cache.set(fingerprint, {
        result: snapshot(),
        expires,
        owner: context.ownerUserId,
        input: structuredClone(input),
        factsKey,
        factsComplete
      });
      while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
