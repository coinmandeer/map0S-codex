import { useMemo, useRef, useState } from "react";
import type {
  LayerImportPreviewV2,
  LayerImportReportV2,
  LayerImportVisibilityV2
} from "@mapos/layer-sdk";
import { apiGet, apiPost } from "../lib/api";
import {
  buildUserLayerPackage,
  packageAsGeoJson,
  type UserLayerTransferSource,
  type UserPinTransferSource
} from "../lib/userLayerPackage";
import {
  inspectLayerImportHostCompatibility,
  type LayerImportHostInspection
} from "../lib/layerImportDashboard";
import { Button, Icon, InfoTip, Menu, Section, Select } from "./kit";

interface TransferLayer extends UserLayerTransferSource {
  pinCount: number;
}

interface LayerImportPreviewResponse {
  previewId: string;
  packageDigest: string;
  expiresAt: string;
  preview: LayerImportPreviewV2;
}

interface CommittedLayerImport {
  layer: TransferLayer;
  report: LayerImportReportV2;
}

function filename(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "mapos-layer"
  );
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function HostCompatibilityCard({ inspection }: { inspection: LayerImportHostInspection }) {
  const { declaration, host, report } = inspection;
  const status = !declaration.present
    ? "Bez manifestu"
    : report?.valid
      ? "Kompatibilní"
      : "Nekompatibilní";
  return (
    <div
      className={`layer-host-report ${report?.valid ? "is-compatible" : "is-blocked"}`}
      data-testid="layer-host-compatibility"
    >
      <strong>Host kompatibilita: {status}</strong>
      <dl>
        <div>
          <dt>Manifest</dt>
          <dd>
            {declaration.schema ?? "—"} {declaration.schemaVersion ?? ""}
          </dd>
        </div>
        <div>
          <dt>SDK požadavek</dt>
          <dd>{declaration.sdkRange ?? "—"}</dd>
        </div>
        <div>
          <dt>Min. runtime</dt>
          <dd>{declaration.minimumRuntime ?? "—"}</dd>
        </div>
        <div>
          <dt>Tento host</dt>
          <dd>
            SDK {host.sdkVersion} · runtime {host.runtimeVersion}
          </dd>
        </div>
      </dl>
      {declaration.requiredCapabilities.length > 0 && (
        <small>Požadované služby: {declaration.requiredCapabilities.join(", ")}</small>
      )}
      {!declaration.present && (
        <small>GeoJSON a CSV lze instalovat jen jako soukromou vrstvu.</small>
      )}
      {report?.issues.length ? (
        <ul>
          {report.issues.map((issue) => (
            <li key={`${issue.code}:${issue.path}`}>
              <code>{issue.code}</code> {issue.message}
            </li>
          ))}
        </ul>
      ) : declaration.present ? (
        <small>Ověřeno kanonickým validátorem @mapos/layer-sdk.</small>
      ) : null}
    </div>
  );
}

export function LayerTransferTools({
  layers,
  onImported,
  onRolledBack
}: {
  layers: TransferLayer[];
  onImported(layer: TransferLayer): void;
  onRolledBack(layerId: string): void;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [preview, setPreview] = useState<LayerImportPreviewResponse | null>(null);
  const [inspection, setInspection] = useState<LayerImportHostInspection | null>(null);
  const [visibility, setVisibility] = useState<LayerImportVisibilityV2>("private");
  const [imports, setImports] = useState<CommittedLayerImport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(
    () => layers.find((layer) => layer.id === selectedId) ?? layers[0] ?? null,
    [layers, selectedId]
  );

  const exportLayer = async (format: "mapos-package" | "geojson") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiGet<{ pins: UserPinTransferSource[] }>(
        `/user-layers/${selected.id}/pins`,
        { auth: true }
      );
      const layerPackage = buildUserLayerPackage(selected, data.pins);
      const base = filename(selected.name);
      if (format === "geojson") {
        download(`${base}.geojson`, packageAsGeoJson(layerPackage), "application/geo+json");
      } else {
        download(`${base}.mapos.json`, JSON.stringify(layerPackage, null, 2), "application/json");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export se nepodařil.");
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    setPreview(null);
    setInspection(null);
    setVisibility("private");
    setError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Soubor je větší než bezpečný limit 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      const nextInspection = inspectLayerImportHostCompatibility(content, file.name);
      setInspection(nextInspection);
      const nextPreview = await apiPost<LayerImportPreviewResponse>("/v2/layer-imports/preview", {
        filename: file.name,
        content
      });
      setPreview(nextPreview);
      const canPublish =
        nextPreview.preview.publicationErrors.length === 0 &&
        nextInspection.declaration.present &&
        nextInspection.report?.valid === true;
      setVisibility(
        nextPreview.preview.requestedVisibility === "public" && canPublish ? "public" : "private"
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Náhled importu se nepodařil.");
    } finally {
      setBusy(false);
    }
  };

  const importLayer = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const committed = await apiPost<{ report: LayerImportReportV2 }>(
        `/v2/layer-imports/${preview.previewId}/commit`,
        { visibility }
      );
      if (!committed.report.layerId) throw new Error("Import nevrátil identifikátor vrstvy.");
      const layer: TransferLayer = {
        id: committed.report.layerId,
        name: preview.preview.name,
        color: preview.preview.color,
        isPublic: visibility === "public" ? 1 : 0,
        pinCount: committed.report.featureCount
      };
      setImports((current) => [...current, { layer, report: committed.report }]);
      onImported(layer);
      setPreview(null);
      setInspection(null);
      setVisibility("private");
      if (inputRef.current) inputRef.current.value = "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import se nepodařil.");
    } finally {
      setBusy(false);
    }
  };

  const rollbackImport = async (entry: CommittedLayerImport) => {
    setBusy(true);
    setError(null);
    try {
      const rolledBack = await apiPost<{ report: LayerImportReportV2 }>(
        `/v2/layer-imports/${entry.report.id}/rollback`
      );
      setImports((current) =>
        current.map((candidate) =>
          candidate.report.id === entry.report.id
            ? { ...candidate, report: rolledBack.report }
            : candidate
        )
      );
      onRolledBack(entry.layer.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rollback importu se nepodařil.");
    } finally {
      setBusy(false);
    }
  };

  const publishBlocked =
    !preview ||
    preview.preview.publicationErrors.length > 0 ||
    !inspection?.declaration.present ||
    inspection.report?.valid !== true;

  return (
    <Section
      title="Přenos vrstvy"
      action={
        <InfoTip label="Podporované formáty">
          Import čte balíček MapOS, GeoJSON, CSV a GPX z hodinek či navigace. Export dá balíček se
          všemi poli, nebo GeoJSON pro jiné mapové nástroje.
        </InfoTip>
      }
    >
      <div className="layer-transfer-row">
        {selected && (
          <>
            <Select
              label="Vrstva pro export"
              hideLabel
              value={selected.id}
              onChange={setSelectedId}
              options={layers.map((layer) => ({ value: layer.id, label: layer.name }))}
              testId="layer-export-select"
            />
            {/* One button rather than two: the format is a detail of exporting, not a second
             *  decision to put in front of everyone. */}
            <Menu
              testId="layer-export-menu"
              trigger={
                <Button variant="outlined" icon="download" disabled={busy}>
                  Exportovat
                </Button>
              }
              actions={[
                {
                  id: "mapos-package",
                  label: "Balíček MapOS",
                  onSelect: () => void exportLayer("mapos-package")
                },
                { id: "geojson", label: "GeoJSON", onSelect: () => void exportLayer("geojson") }
              ]}
            />
          </>
        )}
        {/* A file input has to be reached through its own label, so this is the one control here
         *  that cannot be a kit Button. */}
        <label className="layer-import-button" data-busy={busy && !preview ? "" : undefined}>
          <Icon name="upload" size={18} />
          {busy && !preview ? "Připravuji náhled…" : "Importovat ze souboru"}
          <input
            ref={inputRef}
            data-testid="layer-import-file"
            type="file"
            disabled={busy}
            accept=".json,.geojson,.csv,.gpx,application/json,application/geo+json,text/csv,application/gpx+xml"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
        </label>
      </div>
      {inspection && <HostCompatibilityCard inspection={inspection} />}
      {preview && (
        <section
          className="layer-import-preview"
          data-testid="layer-import-preview"
          aria-labelledby="layer-import-preview-title"
        >
          <strong id="layer-import-preview-title">{preview.preview.name}</strong>
          <span>
            {preview.preview.featureCount} bodů · {preview.preview.format} · otisk{" "}
            <code>{preview.packageDigest.slice(0, 12)}…</code>
          </span>
          {preview.preview.sample.length > 0 && (
            <small>
              Ukázka:{" "}
              {preview.preview.sample
                .slice(0, 3)
                .map(({ name }) => name)
                .join(", ")}
            </small>
          )}
          {preview.preview.duplicates.length > 0 && (
            <small>
              Nalezené duplicitní skupiny: {preview.preview.duplicates.length}. Import je
              automaticky nemaže.
            </small>
          )}
          {preview.preview.warnings.map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
          <fieldset className="layer-import-visibility">
            <legend>Viditelnost po instalaci</legend>
            <label>
              <input
                type="radio"
                name="layer-import-visibility"
                value="private"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Soukromá
            </label>
            <label>
              <input
                type="radio"
                name="layer-import-visibility"
                value="public"
                checked={visibility === "public"}
                disabled={publishBlocked}
                onChange={() => setVisibility("public")}
              />
              Veřejná
            </label>
          </fieldset>
          {preview.preview.publicationErrors.length > 0 && (
            <div className="layer-publication-gate" role="note">
              <strong>Zveřejnění je zablokované</strong>
              <ul>
                {preview.preview.publicationErrors.map((publicationError) => (
                  <li key={publicationError}>{publicationError}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            className="btn btn-accent"
            type="button"
            disabled={busy}
            onClick={() => void importLayer()}
          >
            {busy ? "Instaluji…" : "Nainstalovat vrstvu"}
          </button>
        </section>
      )}
      {imports.length > 0 && (
        <section className="layer-import-history" aria-labelledby="layer-import-history-title">
          <h5 id="layer-import-history-title">Import reports</h5>
          {imports.map((entry) => (
            <article key={entry.report.id} data-testid="layer-import-report">
              <div>
                <strong>{entry.layer.name}</strong>
                <small>
                  {entry.report.featureCount} bodů · {entry.layer.isPublic ? "veřejná" : "soukromá"}
                </small>
                <small>
                  {entry.report.schema} {entry.report.schemaVersion} · {entry.report.status}
                </small>
              </div>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy || entry.report.status === "rolled-back"}
                onClick={() => void rollbackImport(entry)}
              >
                {entry.report.status === "rolled-back" ? "Vráceno zpět" : "Vrátit import"}
              </button>
            </article>
          ))}
        </section>
      )}
      {error && (
        <p className="planner-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
