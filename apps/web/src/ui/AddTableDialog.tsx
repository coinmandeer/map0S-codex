import { useEffect, useState } from "react";
import { apiPost } from "../lib/api";
import type { UserTableSummary } from "../layers/themes/tableLayers";
import {
  Button,
  Dialog,
  Icon,
  InfoTip,
  InlineNotice,
  ProgressCircular,
  Select,
  TextField,
  notify
} from "./kit";

/**
 * Turn a spreadsheet into a map (§20.3).
 *
 * Two steps, because detection is a guess and a wrong guess is invisible on the finished map.
 * The server says which column looks like a territory code and which like the value; this
 * dialog shows both with the first rows underneath, so the confirmation is a glance rather than
 * a form to fill in. Everything else — the encoding, the delimiter, the decimal comma — is
 * decided by the parser and never asked about, because nobody knows the answer for a file they
 * just downloaded.
 */

interface TablePreview {
  format: "csv" | "xlsx";
  encoding: string | null;
  delimiter: string | null;
  headers: string[];
  sample: string[][];
  rowCount: number;
  codeColumn: number | null;
  geoLevel: string | null;
  valueColumns: number[];
  matched: number;
  warnings: string[];
}

interface CreatedTable {
  table: UserTableSummary;
  written: number;
  matched: number;
  warnings: string[];
}

const LEVEL_LABELS: Record<string, string> = {
  country: "Státy",
  nuts1: "NUTS 1",
  nuts2: "NUTS 2 (kraje EU)",
  nuts3: "NUTS 3 (kraje)",
  lau: "Obce (LAU)"
};

/** 5 MiB, the ceiling the server enforces; checked here so the file never leaves the machine. */
const MAX_BYTES = 5 * 1024 * 1024;

export function AddTableDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (table: UserTableSummary) => void;
}) {
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [codeColumn, setCodeColumn] = useState(0);
  const [valueColumn, setValueColumn] = useState(0);
  const [level, setLevel] = useState("nuts3");
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [refresh, setRefresh] = useState(false);

  useEffect(() => {
    if (open) return;
    setStep("pick");
    setBusy(false);
    setError(null);
    setPreview(null);
    setContent(null);
    setFilename("");
    setUrl("");
    setName("");
    setRefresh(false);
  }, [open]);

  async function previewFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("Tabulka je větší než 5 MiB.");
      return;
    }
    const base64 = await toBase64(file);
    setContent(base64);
    setFilename(file.name);
    setName((current) => current || file.name.replace(/\.[^.]+$/, ""));
    await runPreview({ content: base64, filename: file.name });
  }

  async function runPreview(body: { content?: string; filename?: string; url?: string }) {
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<TablePreview>("/v2/tables/preview", body);
      setPreview(response);
      setCodeColumn(response.codeColumn ?? 0);
      setValueColumn(response.valueColumns[0] ?? 1);
      if (response.geoLevel) setLevel(response.geoLevel);
      setStep("confirm");
    } catch (cause) {
      setError(messageOf(cause, "Tabulku se nepodařilo přečíst."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<CreatedTable>("/v2/tables", {
        name: name.trim() || filename || "Tabulka",
        ...(content && !url.trim() ? { content, filename } : {}),
        ...(url.trim() ? { url: url.trim() } : {}),
        codeColumn,
        valueColumn,
        geoLevel: level,
        period,
        // A day is the shortest interval worth having for a statistical table, and the longest
        // anyone waits before noticing a stale number.
        ...(refresh && url.trim() ? { refreshIntervalMinutes: 1440 } : {})
      });
      notify(
        response.matched
          ? `„${response.table.name}“ je na mapě: ${response.matched} území.`
          : `„${response.table.name}“ se uložila, ale žádné území nesedělo.`,
        { tone: response.matched ? "success" : "warning" }
      );
      onCreated?.(response.table);
      onOpenChange(false);
    } catch (cause) {
      setError(messageOf(cause, "Tabulku se nepodařilo uložit."));
    } finally {
      setBusy(false);
    }
  }

  const columnOptions = (preview?.headers ?? []).map((header, index) => ({
    value: String(index),
    label: header || `Sloupec ${index + 1}`
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Importovat tabulku"
      size="md"
      testId="add-table-dialog"
      footer={
        <>
          {step === "confirm" && (
            <Button variant="text" testId="add-table-back" onClick={() => setStep("pick")}>
              Zpět
            </Button>
          )}
          {step === "pick" && (
            <Button
              variant="filled"
              icon="search"
              loading={busy}
              disabled={url.trim().length < 8}
              testId="add-table-probe"
              onClick={() => void runPreview({ url: url.trim() })}
            >
              Načíst z odkazu
            </Button>
          )}
          {step === "confirm" && (
            <Button
              variant="filled"
              icon="add"
              loading={busy}
              testId="add-table-save"
              onClick={() => void save()}
            >
              Vytvořit vrstvu
            </Button>
          )}
        </>
      }
    >
      <div className="source-wizard">
        {error && (
          <InlineNotice tone="danger" testId="add-table-error">
            {error}
          </InlineNotice>
        )}

        {step === "pick" && (
          <>
            <label className="layer-import-button">
              <Icon name="upload" size={18} />
              {busy ? "Čtu tabulku…" : "Vybrat soubor"}
              <input
                type="file"
                data-testid="add-table-file"
                disabled={busy}
                accept=".csv,.xlsx,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => void previewFile(event.target.files?.[0])}
              />
            </label>
            <TextField
              label="Nebo adresa tabulky"
              placeholder="https://…/data.csv"
              value={url}
              inputMode="url"
              testId="add-table-url"
              onChange={(event) => setUrl(event.target.value)}
              trailing={
                <InfoTip label="Co sem patří" title="Jaká tabulka se dá zobrazit">
                  CSV nebo XLSX, kde jeden sloupec obsahuje kód území (NUTS jako CZ031, kód státu
                  jako CZ, nebo šestimístný kód obce) a další číselnou hodnotu. Češtinu ve
                  Windows-1250, středníky i desetinné čárky přečteme sami.
                </InfoTip>
              }
            />
            {busy && <ProgressCircular label="Čtu tabulku" />}
          </>
        )}

        {step === "confirm" && preview && (
          <>
            <p className="source-wizard-service">
              <span className="source-wizard-service-name">
                {preview.format.toUpperCase()} · {preview.rowCount} řádků
              </span>
              {preview.encoding && (
                <span className="source-wizard-service-meta">{preview.encoding}</span>
              )}
            </p>
            {preview.warnings.map((warning) => (
              <InlineNotice tone="warning" key={warning}>
                {warning}
              </InlineNotice>
            ))}
            <TextField
              label="Název vrstvy"
              value={name}
              testId="add-table-name"
              onChange={(event) => setName(event.target.value)}
            />
            <Select
              label="Sloupec s kódem území"
              value={String(codeColumn)}
              options={columnOptions}
              testId="add-table-code-column"
              onChange={(next) => setCodeColumn(Number(next))}
            />
            <Select
              label="Sloupec s hodnotou"
              value={String(valueColumn)}
              options={columnOptions}
              testId="add-table-value-column"
              onChange={(next) => setValueColumn(Number(next))}
            />
            <Select
              label="Úroveň území"
              value={level}
              options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label }))}
              testId="add-table-level"
              onChange={setLevel}
            />
            <TextField
              label="Období"
              value={period}
              testId="add-table-period"
              onChange={(event) => setPeriod(event.target.value)}
            />
            {url.trim() && (
              <label className="kit-choice">
                <input
                  type="checkbox"
                  checked={refresh}
                  data-testid="add-table-refresh"
                  onChange={(event) => setRefresh(event.target.checked)}
                />
                Obnovovat jednou denně z odkazu
              </label>
            )}
            <TablePreviewGrid preview={preview} codeColumn={codeColumn} valueColumn={valueColumn} />
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The first rows, with the two chosen columns marked. Reading them is the confirmation. */
function TablePreviewGrid({
  preview,
  codeColumn,
  valueColumn
}: {
  preview: TablePreview;
  codeColumn: number;
  valueColumn: number;
}) {
  return (
    <div className="table-preview" data-testid="add-table-preview">
      <table>
        <thead>
          <tr>
            {preview.headers.map((header, index) => (
              <th key={index} data-role={roleOf(index, codeColumn, valueColumn)}>
                {header || `#${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.sample.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {preview.headers.map((_header, index) => (
                <td key={index} data-role={roleOf(index, codeColumn, valueColumn)}>
                  {row[index] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function roleOf(index: number, codeColumn: number, valueColumn: number): string | undefined {
  if (index === codeColumn) return "code";
  if (index === valueColumn) return "value";
  return undefined;
}

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunked: `String.fromCharCode(...bytes)` on a multi-megabyte file overflows the argument
  // list, and the failure looks like a corrupt upload rather than a stack limit.
  for (let index = 0; index < buffer.length; index += 8192) {
    binary += String.fromCharCode(...buffer.subarray(index, index + 8192));
  }
  return btoa(binary);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
