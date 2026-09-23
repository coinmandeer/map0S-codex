import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskRecordV2, TaskStatusV2, TaskTypeV2 } from "@mapos/layer-sdk";
import { ACTIVITY_MAX_ROWS, activityRows, activitySummary } from "./activityModel.js";

function task(
  id: string,
  overrides: Partial<TaskRecordV2> & { status: TaskStatusV2; type?: TaskTypeV2 }
): TaskRecordV2 {
  return {
    schema: "mapos.task",
    schemaVersion: "2.0.0",
    id,
    type: "layer-query",
    label: id,
    startedAt: "2026-09-02T10:00:00.000Z",
    cancellable: false,
    ...overrides
  };
}

describe("activityRows", () => {
  it("keeps running and queued tasks and drops settled ones the caller no longer holds", () => {
    const rows = activityRows(
      [
        task("a", { status: "running" }),
        task("b", { status: "queued" }),
        task("c", { status: "succeeded" }),
        task("d", { status: "failed" })
      ],
      new Set(["d"])
    );

    assert.deepEqual(
      rows.map((row) => row.id),
      ["d", "a", "b"]
    );
  });

  it("puts failures first, then newest, and never exceeds the row cap", () => {
    const rows = activityRows(
      [
        task("old", { status: "running", startedAt: "2026-09-02T10:00:00.000Z" }),
        task("mid", { status: "running", startedAt: "2026-09-02T10:00:05.000Z" }),
        task("new", { status: "running", startedAt: "2026-09-02T10:00:10.000Z" }),
        task("broken", {
          status: "failed",
          startedAt: "2026-09-02T09:00:00.000Z",
          error: { code: "network", message: "Zdroj neodpověděl", retryable: true }
        })
      ],
      new Set(["broken"])
    );

    assert.equal(rows.length, ACTIVITY_MAX_ROWS);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["broken", "new", "mid"]
    );
    assert.equal(rows[0]!.tone, "error");
    assert.equal(rows[0]!.icon, "error");
    assert.equal(rows[0]!.detail, "Zdroj neodpověděl");
  });

  it("marks a settled success with a tick so the row can flash before it fades", () => {
    const [row] = activityRows([task("a", { status: "succeeded" })], new Set(["a"]));
    assert.equal(row!.tone, "done");
    assert.equal(row!.icon, "check");
  });

  it("picks an icon per task type", () => {
    const rows = activityRows(
      [
        task("r", { status: "running", type: "routing" }),
        task("t", { status: "running", type: "tile-load" }),
        task("i", { status: "running", type: "ai" })
      ],
      new Set()
    );
    assert.deepEqual(rows.map((row) => row.icon).sort(), ["auto_awesome", "map", "route"]);
  });
});

describe("activitySummary", () => {
  it("is null with nothing happening", () => {
    assert.equal(activitySummary([]), null);
  });

  it("names a single running source and counts progress once there are several", () => {
    assert.equal(
      activitySummary([{ id: "a", label: "Loading campsites", tone: "running", icon: "layers" }]),
      "Loading campsites"
    );
    // Five sources asked, three still working: the reader wants the progress, not five pills.
    assert.equal(
      activitySummary(
        [
          { id: "a", label: "Loading campsites", tone: "running", icon: "layers" },
          { id: "b", label: "Loading radar", tone: "running", icon: "cloud" },
          { id: "c", label: "Loading trails", tone: "running", icon: "route" }
        ],
        5
      ),
      "Loading 2/5 sources"
    );
  });

  it("prefers the failure over anything still running", () => {
    assert.equal(
      activitySummary([
        { id: "b", label: "A layer failed to load", tone: "error", icon: "error" },
        { id: "a", label: "Loading campsites", tone: "running", icon: "layers" }
      ]),
      "A layer failed to load"
    );
  });
});
