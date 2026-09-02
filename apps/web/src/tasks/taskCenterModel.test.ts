import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskRecordV2, TaskTypeV2 } from "@mapos/layer-sdk";
import { taskCenterModel, taskProgressLabel, taskTypeLabel } from "./taskCenterModel";

function task(
  id: string,
  type: TaskTypeV2,
  status: TaskRecordV2["status"],
  progress: number | null = null
): TaskRecordV2 {
  return {
    schema: "mapos.task",
    schemaVersion: "2.0.0",
    id,
    type,
    label: `Úloha ${id}`,
    status,
    progress,
    message: status === "failed" ? "Bezpečná chyba" : null,
    layerId: null,
    parentId: null,
    requestKey: null,
    startedAt: "2026-09-02T10:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-09-02T10:00:01.000Z",
    cancellable: status === "running",
    error:
      status === "failed" ? { code: "UPSTREAM", message: "Bezpečná chyba", retryable: true } : null,
    telemetry: {}
  };
}

describe("taskCenterModel", () => {
  it("keeps concurrent work separate and puts active entries before failures", () => {
    const model = taskCenterModel([
      task("failed", "weather", "failed"),
      task("route", "routing", "running", 0.42),
      task("pins", "layer-query", "queued"),
      task("done", "export", "succeeded", 1)
    ]);
    assert.deepEqual(
      model.entries.map(({ id }) => id),
      ["route", "pins", "failed"]
    );
    assert.equal(model.compactLabel, "2 souběžné úlohy");
    assert.equal(model.hasFailure, true);
  });

  it("uses short Czech operation and progress labels", () => {
    const localized: Array<[TaskTypeV2, string]> = [
      ["layer-query", "Piny a místa"],
      ["tile-load", "Mapový podklad"],
      ["geocode", "Hledání adresy"],
      ["reverse-geocode", "Určení místa"],
      ["routing", "Výpočet trasy"],
      ["weather", "Počasí"],
      ["event-search", "Události"],
      ["ai", "AI zpracování"],
      ["poi-enrichment", "Detail místa"],
      ["import", "Import dat"],
      ["export", "Export dat"],
      ["sync", "Synchronizace"],
      ["game-asset", "Herní data"],
      ["commerce", "Platba"]
    ];
    assert.deepEqual(
      localized.map(([type]) => taskTypeLabel(type)),
      localized.map(([, label]) => label)
    );
    assert.equal(taskProgressLabel(task("route", "routing", "running", 0.426)), "43 %");
    assert.equal(taskProgressLabel(task("weather", "weather", "failed")), "Chyba");
  });

  it("summarises a lone failure without exposing completed history", () => {
    const model = taskCenterModel([
      task("done", "export", "succeeded", 1),
      task("failed", "ai", "failed")
    ]);
    assert.equal(model.compactLabel, "1 úloha vyžaduje pozornost");
    assert.deepEqual(
      model.entries.map(({ id }) => id),
      ["failed"]
    );
  });
});
