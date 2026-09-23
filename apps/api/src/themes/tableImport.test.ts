import assert from "node:assert/strict";
import test from "node:test";
import type { TableObservation } from "@mapos/layer-sdk";
import {
  dueForRefresh,
  ingestTable,
  previewTable,
  refreshTable,
  tableDatasetId,
  type TableDefinition,
  type TableIngestDeps
} from "./tableImport.js";

const CSV = [
  "kod;nazev;pocet",
  "CZ031;Jihočeský kraj;640,1",
  "CZ032;Plzeňský kraj;811,4",
  "CZ041;Karlovarský kraj;1 002"
].join("\n");

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function deps(overrides: Partial<TableIngestDeps> = {}) {
  const persisted: Array<{
    datasetId: string;
    level: string;
    period: string;
    rows: TableObservation[];
  }> = [];
  const saved: TableDefinition[] = [];
  const io: TableIngestDeps = {
    fetchTable: async () => ({ bytes: bytes(CSV), filename: "remote.csv" }),
    persist: async (datasetId, level, period, rows) => {
      persisted.push({ datasetId, level, period, rows: [...rows] });
    },
    countMatched: async (_level, codes) => codes.length,
    saveDefinition: async (definition) => {
      saved.push(definition);
    },
    ...overrides
  };
  return { io, persisted, saved };
}

test("a preview reports the columns it found and what it is unsure about", () => {
  const preview = previewTable(bytes(CSV), "kraje.csv");
  assert.equal(preview.format, "csv");
  assert.equal(preview.delimiter, ";");
  assert.equal(preview.codeColumn, 0);
  assert.equal(preview.geoLevel, "nuts3");
  assert.deepEqual(preview.valueColumns, [2]);
  assert.equal(preview.rowCount, 3);
  assert.deepEqual(preview.warnings, []);
});

test("a table with no code column previews rather than failing, and says why", () => {
  const preview = previewTable(bytes("nazev;pocet\nJihočeský kraj;640"), "x.csv");
  assert.equal(preview.codeColumn, null);
  assert.match(preview.warnings.join(" "), /kódem území/);
});

test("an empty table is refused before anything is stored", () => {
  assert.throws(() => previewTable(bytes("kod;pocet"), "x.csv"), /žádné řádky/);
});

test("an import stores the joined values under the table's own dataset id", async () => {
  const { io, persisted, saved } = deps();
  const result = await ingestTable(
    { ownerId: "user-1", name: "Kriminalita 2023", bytes: bytes(CSV), period: "2023" },
    io
  );

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.datasetId, tableDatasetId(result.definition.id));
  assert.equal(persisted[0]!.level, "nuts3");
  assert.equal(persisted[0]!.period, "2023");
  assert.deepEqual(persisted[0]!.rows, [
    { geoCode: "CZ031", value: 640.1 },
    { geoCode: "CZ032", value: 811.4 },
    { geoCode: "CZ041", value: 1002 }
  ]);
  assert.equal(saved[0]!.valueLabel, "pocet");
  assert.equal(saved[0]!.geoLevel, "nuts3");
});

test("codes the map does not know are counted and reported, not silently dropped", async () => {
  const { io } = deps({ countMatched: async () => 1 });
  const result = await ingestTable({ ownerId: "user-1", name: "Tabulka", bytes: bytes(CSV) }, io);
  assert.equal(result.matched, 1);
  assert.match(result.warnings.join(" "), /2 kódů jsme v mapě nenašli/);
});

test("a period defaults to the current year rather than to nothing", async () => {
  const { io, persisted } = deps();
  await ingestTable({ ownerId: "user-1", name: "Tabulka", bytes: bytes(CSV) }, io);
  assert.equal(persisted[0]!.period, String(new Date().getUTCFullYear()));
});

test("an import with neither a file nor a link is refused", async () => {
  const { io } = deps();
  await assert.rejects(ingestTable({ ownerId: "user-1", name: "Tabulka" }, io), /Chybí soubor/);
});

test("a linked table is fetched, and its url is kept so it can be fetched again", async () => {
  const { io, saved } = deps();
  const result = await ingestTable(
    { ownerId: "user-1", name: "Odkaz", sourceUrl: "https://example.test/kraje.csv" },
    io
  );
  assert.equal(saved[0]!.sourceUrl, "https://example.test/kraje.csv");
  assert.equal(result.written, 3);
});

test("a refresh keeps the chosen columns instead of detecting them again", async () => {
  const wider = [
    "kod;nazev;pocet;novy_sloupec",
    "CZ031;Jihočeský kraj;640,1;1",
    "CZ032;Plzeňský kraj;811,4;2"
  ].join("\n");
  const { io, persisted } = deps({
    fetchTable: async () => ({ bytes: bytes(wider), filename: "remote.csv" })
  });

  const definition: TableDefinition = {
    id: "table-1",
    ownerId: "user-1",
    name: "Odkaz",
    sourceUrl: "https://example.test/kraje.csv",
    format: "csv",
    encoding: "utf-8",
    geoLevel: "nuts3",
    codeColumn: 0,
    valueColumn: 2,
    valueLabel: "pocet",
    unit: null,
    period: "2023",
    refreshIntervalMinutes: 1440
  };

  const result = await refreshTable(definition, io);
  assert.equal(result.definition.id, "table-1", "a refresh must not mint a new dataset");
  assert.deepEqual(persisted[0]!.rows, [
    { geoCode: "CZ031", value: 640.1 },
    { geoCode: "CZ032", value: 811.4 }
  ]);
});

test("an uploaded table cannot be refreshed, because there is nothing to refresh from", async () => {
  const { io } = deps();
  await assert.rejects(
    refreshTable(
      {
        id: "table-2",
        ownerId: "user-1",
        name: "Nahraná",
        sourceUrl: null,
        format: "csv",
        encoding: "utf-8",
        geoLevel: "nuts3",
        codeColumn: 0,
        valueColumn: 1,
        valueLabel: "pocet",
        unit: null,
        period: "2023",
        refreshIntervalMinutes: null
      },
      io
    ),
    /nemá odkaz/
  );
});

test("only linked tables past their interval are due, oldest first", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const due = dueForRefresh(
    [
      {
        sourceUrl: "https://a.test",
        refreshIntervalMinutes: 60,
        refreshedAt: "2026-09-03T11:00:00Z"
      },
      { sourceUrl: null, refreshIntervalMinutes: 60, refreshedAt: "2020-01-01T00:00:00Z" },
      {
        sourceUrl: "https://b.test",
        refreshIntervalMinutes: null,
        refreshedAt: "2020-01-01T00:00:00Z"
      },
      {
        sourceUrl: "https://c.test",
        refreshIntervalMinutes: 60,
        refreshedAt: "2026-09-03T09:00:00Z"
      },
      {
        sourceUrl: "https://d.test",
        refreshIntervalMinutes: 60,
        refreshedAt: "2026-09-03T11:30:00Z"
      }
    ],
    now
  );
  assert.deepEqual(due, [3, 0], "uploaded and interval-less tables are never due");
});
