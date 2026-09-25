import assert from "node:assert/strict";
import test from "node:test";
import { statDataset, type StatDatasetDescriptor, type StatObservation } from "@mapos/adapter-sdk";
import { importAllStatDatasets, importStatDataset } from "./statSeriesImport.js";

const JSON_STAT = {
  id: ["geo", "time"],
  size: [2, 2],
  dimension: {
    geo: { category: { index: { CZ032: 0, AT127: 1 } } },
    time: { category: { index: { "2022": 0, "2023": 1 } } }
  },
  value: { 0: 811.4, 1: 795, 2: 1204.7, 3: null }
};

test("a Eurostat payload becomes rows tagged with the dataset's own geo level", async () => {
  const rows: StatObservation[] = [];
  const levels: string[] = [];
  const result = await importStatDataset(statDataset("eurostat-crim-gen-reg")!, {
    fetchDataset: async () => JSON_STAT,
    persist: async (dataset, batch) => {
      levels.push(dataset.geoLevel);
      rows.push(...batch);
    }
  });

  assert.equal(result.observations, 4);
  assert.equal(result.written, 4);
  assert.deepEqual(result.periods, ["2022", "2023"]);
  assert.deepEqual(levels, ["nuts3"]);
  assert.deepEqual(
    rows.map((row) => [row.geoCode, row.period, row.value]),
    [
      ["CZ032", "2022", 811.4],
      ["CZ032", "2023", 795],
      ["AT127", "2022", 1204.7],
      ["AT127", "2023", null]
    ]
  );
});

test("an observation with no value is stored, because it is not the same as never measured", async () => {
  const rows: StatObservation[] = [];
  await importStatDataset(statDataset("eurostat-crim-gen-reg")!, {
    fetchDataset: async () => JSON_STAT,
    persist: async (_dataset, batch) => {
      rows.push(...batch);
    }
  });
  assert.ok(rows.some((row) => row.value === null));
});

test("the dataset description is written once, with the periods that were imported", async () => {
  const described: Array<[string, string[]]> = [];
  await importStatDataset(statDataset("eurostat-demo-r-pjanaggr3")!, {
    fetchDataset: async () => JSON_STAT,
    persist: async () => {},
    describe: async (dataset, periods) => {
      described.push([dataset.id, [...periods]]);
    }
  });
  assert.deepEqual(described, [["eurostat-demo-r-pjanaggr3", ["2022", "2023"]]]);
});

test("only the requested datasets are fetched", async () => {
  const fetched: string[] = [];
  const results = await importAllStatDatasets(["worldbank-sp-pop-totl"], {
    fetchDataset: async (dataset: StatDatasetDescriptor) => {
      fetched.push(dataset.id);
      return [{ page: 1 }, [{ country: { id: "CZ", value: "Czechia" }, date: "2023", value: 10 }]];
    },
    persist: async () => {}
  });
  assert.deepEqual(fetched, ["worldbank-sp-pop-totl"]);
  assert.deepEqual(
    results.map((result) => [result.datasetId, result.observations]),
    [["worldbank-sp-pop-totl", 1]]
  );
});

test("a long series is persisted in batches, and every row is accounted for", async () => {
  const sizes: number[] = [];
  const value: Record<string, number> = {};
  const index: Record<string, number> = {};
  for (let position = 0; position < 1200; position += 1) {
    value[String(position)] = position;
    index[`CZ${position.toString(36).toUpperCase().padStart(3, "0")}`] = position;
  }
  const result = await importStatDataset(statDataset("eurostat-crim-gen-reg")!, {
    fetchDataset: async () => ({
      id: ["geo", "time"],
      size: [1200, 1],
      dimension: { geo: { category: { index } }, time: { category: { index: { "2023": 0 } } } },
      value
    }),
    persist: async (_dataset, batch) => {
      sizes.push(batch.length);
    }
  });
  assert.equal(result.written, 1200);
  assert.deepEqual(sizes, [500, 500, 200]);
});
