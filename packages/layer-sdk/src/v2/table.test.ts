import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  columnIndex,
  decodeTableText,
  detectDelimiter,
  detectTerritoryColumn,
  detectValueColumns,
  joinTable,
  looksLikeSjtsk,
  looksLikeXlsx,
  parseTable,
  parseTableNumber,
  parseXlsxRows,
  sjtskToWgs84
} from "./table.js";

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The bytes an export from a Czech Windows machine actually contains. */
function cp1250(text: string): Uint8Array {
  const map: Record<string, number> = {
    Č: 0xc8,
    č: 0xe8,
    ě: 0xec,
    í: 0xed,
    ř: 0xf8,
    š: 0x9a,
    ý: 0xfd,
    ž: 0x9e,
    á: 0xe1,
    é: 0xe9,
    ň: 0xf2,
    ť: 0x9d,
    ů: 0xf9,
    ú: 0xfa,
    ó: 0xf3,
    ď: 0xef
  };
  return new Uint8Array([...text].map((char) => map[char] ?? char.charCodeAt(0)));
}

test("a UTF-8 file is read as UTF-8, BOM or not", () => {
  assert.deepEqual(decodeTableText(utf8("kód;počet\nCZ031;12")), {
    text: "kód;počet\nCZ031;12",
    encoding: "utf-8"
  });
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("kód")]);
  assert.equal(decodeTableText(withBom).text, "kód", "the BOM must not survive into the header");
});

test("a Windows-1250 file is recognised by UTF-8 refusing it, and its accents survive", () => {
  const decoded = decodeTableText(cp1250("kód;Plzeňský kraj;příliš žluťoučký"));
  assert.equal(decoded.encoding, "windows-1250");
  assert.equal(decoded.text, "kód;Plzeňský kraj;příliš žluťoučký");
});

test("the delimiter is decided on the header, not on the whole file", () => {
  // A description column full of commas must not outvote the semicolons that separate fields.
  const text = 'kod;nazev;popis\nCZ031;Jihočeský;"a, b, c, d, e, f"';
  assert.equal(detectDelimiter(text), ";");
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter("single\n1"), ",", "one column is still a readable table");
});

test("Czech number formatting is read, and a no-data marker is not read as zero", () => {
  assert.equal(parseTableNumber("1 234,5"), 1234.5);
  assert.equal(parseTableNumber("1\u00a0234,5"), 1234.5);
  assert.equal(parseTableNumber("12"), 12);
  assert.equal(parseTableNumber("-3,25"), -3.25);
  assert.equal(parseTableNumber(":"), null);
  assert.equal(parseTableNumber("N/A"), null);
  assert.equal(parseTableNumber(""), null);
  assert.equal(parseTableNumber("Jihočeský kraj"), null);
});

const REGIONS = [
  ["kod", "nazev", "hodnota"],
  ["CZ031", "Jihočeský kraj", "640,1"],
  ["CZ032", "Plzeňský kraj", "811,4"],
  ["CZ041", "Karlovarský kraj", "1 002"]
];

test("the code column is found by the shape of its values, not by its header", () => {
  const found = detectTerritoryColumn(REGIONS)!;
  assert.equal(found.index, 0);
  assert.equal(found.level, "nuts3");
  assert.equal(found.matched, 3);
});

test("a two-letter code column is read as countries", () => {
  const found = detectTerritoryColumn([
    ["geo", "value"],
    ["CZ", "10"],
    ["SK", "5"],
    ["AT", "9"]
  ])!;
  assert.equal(found.level, "country");
});

test("a six-digit municipality number is a LAU code, not a measurement", () => {
  const found = detectTerritoryColumn([
    ["obec", "obyvatel"],
    ["554782", "1300000"],
    ["582786", "94000"]
  ])!;
  assert.equal(found.level, "lau");
  assert.equal(found.index, 0);
});

test("a table with no code column says so instead of joining on something else", () => {
  assert.equal(
    detectTerritoryColumn([
      ["nazev", "hodnota"],
      ["Jihočeský kraj", "640"]
    ]),
    null
  );
});

test("value columns are the numeric ones, and the code column is never one of them", () => {
  assert.deepEqual(detectValueColumns(REGIONS, 0), [2]);
});

test("a join produces one observation per territory, with the Czech decimals parsed", () => {
  const joined = joinTable(REGIONS);
  assert.equal(joined.level, "nuts3");
  assert.deepEqual(joined.observations, [
    { geoCode: "CZ031", value: 640.1 },
    { geoCode: "CZ032", value: 811.4 },
    { geoCode: "CZ041", value: 1002 }
  ]);
  assert.deepEqual(joined.warnings, []);
});

test("a repeated code keeps the first row and says how many it dropped", () => {
  const joined = joinTable([...REGIONS, ["CZ031", "Jihočeský kraj", "999"]]);
  assert.equal(joined.observations.length, 3);
  assert.equal(joined.observations[0]!.value, 640.1);
  assert.match(joined.warnings.join(" "), /opakuje/);
});

test("a territory with no number is kept as an absence, not dropped", () => {
  const joined = joinTable([...REGIONS, ["CZ042", "Ústecký kraj", ":"]]);
  assert.deepEqual(joined.observations.at(-1), { geoCode: "CZ042", value: null });
  assert.match(joined.warnings.join(" "), /nemá v tabulce hodnotu/);
});

test("the caller can override the columns the detection picked", () => {
  const joined = joinTable(
    [
      ["rok", "kod", "muzi", "zeny"],
      ["2023", "CZ031", "5", "7"]
    ],
    { codeColumn: 1, valueColumn: 3 }
  );
  assert.deepEqual(joined.observations, [{ geoCode: "CZ031", value: 7 }]);
});

/** A minimal but real XLSX: the parts Excel writes that a reader actually needs. */
function workbook(rows: string[][]): Uint8Array {
  const shared: string[] = [];
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, column) => {
          const reference = `${String.fromCharCode(65 + column)}${rowIndex + 1}`;
          if (value === "") return "";
          const numeric = /^-?\d+(\.\d+)?$/.test(value);
          if (numeric) return `<c r="${reference}"><v>${value}</v></c>`;
          let index = shared.indexOf(value);
          if (index < 0) index = shared.push(value) - 1;
          return `<c r="${reference}" t="s"><v>${index}</v></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8("<workbook/>"),
    "xl/sharedStrings.xml": strToU8(
      `<sst count="${shared.length}">${shared.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`
    )
  });
}

test("a spreadsheet column reference is base-26 with no zero", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("Z9"), 25);
  assert.equal(columnIndex("AA1"), 26);
  assert.equal(columnIndex("BC12"), 54);
});

test("an XLSX is read into rows, with shared strings resolved", () => {
  const bytes = workbook([
    ["kod", "nazev", "hodnota"],
    ["CZ031", "Jihočeský kraj", "640.1"]
  ]);
  assert.equal(looksLikeXlsx(bytes), true);
  assert.deepEqual(parseXlsxRows(bytes), [
    ["kod", "nazev", "hodnota"],
    ["CZ031", "Jihočeský kraj", "640.1"]
  ]);
});

test("a gap in a sheet keeps later values in their own column", () => {
  // Excel omits an empty cell entirely; reading cells in sequence would shift `640.1` left.
  const bytes = workbook([
    ["kod", "nazev", "hodnota"],
    ["CZ031", "", "640.1"]
  ]);
  const rows = parseXlsxRows(bytes);
  assert.deepEqual(rows[1], ["CZ031", "", "640.1"]);
  assert.equal(joinTable(rows).observations[0]!.value, 640.1);
});

test("parseTable routes by content, so a mis-named spreadsheet still opens", () => {
  const bytes = workbook([
    ["kod", "hodnota"],
    ["CZ031", "1"]
  ]);
  assert.equal(parseTable(bytes, "download").format, "xlsx");

  const csv = parseTable(cp1250("kód;hodnota\nCZ031;640,1"), "data.csv");
  assert.equal(csv.format, "csv");
  assert.equal(csv.encoding, "windows-1250");
  assert.equal(csv.delimiter, ";");
  assert.deepEqual(csv.rows[0], ["kód", "hodnota"]);
});

test("S-JTSK is recognised by its range, whichever order the columns are in", () => {
  assert.equal(looksLikeSjtsk(-743773, -1043466), true);
  assert.equal(looksLikeSjtsk(-1043466, -743773), true);
  assert.equal(looksLikeSjtsk(14.4, 50.08), false, "degrees are not metres");
  assert.equal(looksLikeSjtsk(743773, 1043466), false, "the projection's values are negative");
});

test("a Křovák pair lands where the place is", () => {
  const praha = sjtskToWgs84(-743773, -1043466);
  assert.ok(Math.abs(praha.lng - 14.4093) < 0.001, `lng ${praha.lng}`);
  assert.ok(Math.abs(praha.lat - 50.0824) < 0.001, `lat ${praha.lat}`);

  // Swapping the columns must not move the point: the ranges say which is which.
  const swapped = sjtskToWgs84(-1043466, -743773);
  assert.ok(Math.abs(swapped.lng - praha.lng) < 1e-9);
  assert.ok(Math.abs(swapped.lat - praha.lat) < 1e-9);

  const brno = sjtskToWgs84(-597571, -1160121);
  assert.ok(Math.abs(brno.lng - 16.6156) < 0.001, `lng ${brno.lng}`);
  assert.ok(Math.abs(brno.lat - 49.2014) < 0.001, `lat ${brno.lat}`);
});
