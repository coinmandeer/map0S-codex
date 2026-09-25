import { useEffect, useMemo, useState } from "react";
import type { SourceProbe, SourceSublayer } from "@mapos/adapter-sdk";
import { apiPost } from "../lib/api";
import { plural } from "./layers/layerPresentation";
import {
  Button,
  Checkbox,
  Chip,
  EmptyState,
  InfoTip,
  InlineNotice,
  ListItem,
  ProgressCircular,
  SearchField,
  TextField,
  Dialog,
  notify
} from "./kit";

/**
 * Add a layer from a URL somebody pasted.
 *
 * The point of the whole adapter stack is that this needs no code per source: a public WMS, an
 * ArcGIS service or a PMTiles archive becomes a layer with a legend and attribution because the
 * adapter read the service's own description of itself. So the dialog is deliberately three
 * short steps and not a form — paste, choose what to draw, name it — with the service supplying
 * everything else.
 *
 * The probe runs on the server (`/v2/sources/probe`), which is not an implementation detail the
 * user should notice, but it is why the middle step is instant: the sublayer list came back with
 * the probe, so filtering and re-picking cost nothing.
 */
type Step = "url" | "pick" | "name";

interface ProbeResponse {
  probe: SourceProbe;
  candidates: Array<{ adapterId: string; label: string; confidence: number }>;
}

interface CreatedLayer {
  id: string;
  name: string;
}

/** A service publishing hundreds of layers is normal, and rendering them all makes the dialog
 *  the slow part rather than the network. The search field is how the rest are reached. */
const VISIBLE_SUBLAYERS = 40;

export function AddSourceDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (layer: CreatedLayer) => void;
}) {
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProbeResponse | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (open) return;
    // Reset on close rather than on open, so reopening after a mistake does not flash the last
    // service's layer list.
    setStep("url");
    setUrl("");
    setError(null);
    setResult(null);
    setChosen([]);
    setQuery("");
    setName("");
    setShared(false);
    setBusy(false);
  }, [open]);

  const drawable = useMemo(
    () => result?.probe.sublayers.filter((sublayer) => sublayer.selectable) ?? [],
    [result]
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return drawable;
    return drawable.filter(
      (sublayer) =>
        sublayer.title.toLowerCase().includes(needle) || sublayer.id.toLowerCase().includes(needle)
    );
  }, [drawable, query]);

  async function probe() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<ProbeResponse>("/v2/sources/probe", { url: url.trim() });
      setResult(response);
      const selectable = response.probe.sublayers.filter((sublayer) => sublayer.selectable);
      // One drawable layer is not a choice, so it is made and the step skipped.
      setChosen(selectable.length === 1 ? [selectable[0]!.id] : []);
      setName(response.probe.title);
      setStep(selectable.length === 1 ? "name" : "pick");
    } catch (cause) {
      setError(messageOf(cause, "Zdroj se nepodařilo přečíst."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<{ layer: CreatedLayer }>("/v2/sources/layers", {
        url: url.trim(),
        probe: result.probe,
        sublayerIds: chosen,
        name: name.trim() || result.probe.title,
        isPublic: shared
      });
      notify(`Vrstva „${response.layer.name}“ je přidaná.`, { tone: "success" });
      onCreated?.(response.layer);
      onOpenChange(false);
    } catch (cause) {
      setError(messageOf(cause, "Vrstvu se nepodařilo uložit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Přidat zdroj z URL"
      size="md"
      testId="add-source-dialog"
      footer={
        <>
          {step !== "url" && (
            <Button
              variant="text"
              testId="add-source-back"
              onClick={() => setStep(step === "name" && drawable.length > 1 ? "pick" : "url")}
            >
              Zpět
            </Button>
          )}
          {step === "url" && (
            <Button
              variant="filled"
              icon="search"
              loading={busy}
              disabled={url.trim().length < 8}
              testId="add-source-probe"
              onClick={() => void probe()}
            >
              Prozkoumat
            </Button>
          )}
          {step === "pick" && (
            <Button
              variant="filled"
              disabled={!chosen.length}
              testId="add-source-continue"
              onClick={() => setStep("name")}
            >
              Pokračovat
            </Button>
          )}
          {step === "name" && (
            <Button
              variant="filled"
              icon="add"
              loading={busy}
              testId="add-source-save"
              onClick={() => void save()}
            >
              Přidat vrstvu
            </Button>
          )}
        </>
      }
    >
      <div className="source-wizard">
        {error && (
          <InlineNotice tone="danger" testId="add-source-error">
            {error}
          </InlineNotice>
        )}

        {step === "url" && (
          <>
            <TextField
              label="Adresa služby"
              placeholder="https://…"
              value={url}
              autoFocus
              inputMode="url"
              testId="add-source-url"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && url.trim().length >= 8 && !busy) void probe();
              }}
              trailing={
                <InfoTip label="Podporované zdroje" title="Co sem můžeš vložit">
                  Adresu WMS nebo WMTS služby, ArcGIS REST služby (MapServer nebo FeatureServer)
                  nebo archivu PMTiles. MapOS si z ní sám přečte, jaké vrstvy nabízí, jak se jmenují
                  a koho uvést jako zdroj.
                </InfoTip>
              }
            />
            {busy && <ProgressCircular label="Čtu, co služba nabízí" />}
          </>
        )}

        {step === "pick" && result && (
          <>
            <p className="source-wizard-service">
              <span className="source-wizard-service-name">{result.probe.title}</span>
              <span className="source-wizard-service-meta">
                {drawable.length} {plural(drawable.length, "vrstva", "vrstvy", "vrstev")}
              </span>
              <Chip label={adapterLabel(result)} />
            </p>
            {(result.probe.kind === "wmts" || result.probe.delivery === "features") && (
              <p>Vyber jednu vrstvu. Další můžeš přidat samostatně.</p>
            )}
            {drawable.length > VISIBLE_SUBLAYERS && (
              <SearchField
                label="Najít vrstvu"
                hideLabel
                placeholder={`Hledat mezi ${drawable.length} vrstvami`}
                value={query}
                testId="add-source-search"
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            {filtered.length === 0 ? (
              <EmptyState
                icon="search"
                title={
                  drawable.length
                    ? "Žádná vrstva neodpovídá hledání"
                    : "Tento zdroj nemá vrstvy podporované mapou"
                }
              />
            ) : (
              <ul className="source-wizard-list" data-testid="add-source-sublayers">
                {filtered.slice(0, VISIBLE_SUBLAYERS).map((sublayer) => (
                  <li key={sublayer.id}>
                    <Checkbox
                      checked={chosen.includes(sublayer.id)}
                      testId={`add-source-sublayer-${sublayer.id}`}
                      label={sublayerLabel(sublayer)}
                      onChange={(next) =>
                        setChosen((current) =>
                          next
                            ? result.probe.kind === "wmts" || result.probe.delivery === "features"
                              ? [sublayer.id]
                              : [...current, sublayer.id]
                            : current.filter((id) => id !== sublayer.id)
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {step === "name" && result && (
          <>
            <TextField
              label="Název vrstvy"
              value={name}
              autoFocus
              maxLength={120}
              testId="add-source-name"
              onChange={(event) => setName(event.target.value)}
            />
            <ListItem
              icon="layers"
              title={chosenTitles(result.probe, chosen)}
              subtitle={`${adapterLabel(result)} · ${new URL(result.probe.endpoint).hostname}`}
            />
            {result.probe.attribution?.[0] && (
              <ListItem
                icon="info"
                title={result.probe.attribution[0].label}
                subtitle="Uvedeno u vrstvy na mapě"
              />
            )}
            <Checkbox
              checked={shared}
              onChange={setShared}
              testId="add-source-public"
              label={
                <>
                  Zveřejnit vrstvu
                  <InfoTip label="Co se zveřejní" title="Co se zveřejní">
                    Ostatní uvidí název vrstvy a adresu služby, ze které se dlaždice stahují. Data
                    zůstávají u poskytovatele — MapOS je nekopíruje.
                  </InfoTip>
                </>
              }
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

function adapterLabel(result: ProbeResponse): string {
  return (
    result.candidates.find((candidate) => candidate.adapterId === result.probe.adapterId)?.label ??
    result.probe.adapterId
  );
}

function sublayerLabel(sublayer: SourceSublayer): string {
  return sublayer.title === sublayer.id ? sublayer.title : `${sublayer.title} (${sublayer.id})`;
}

function chosenTitles(probe: SourceProbe, chosen: readonly string[]): string {
  const titles = chosen.map(
    (id) => probe.sublayers.find((sublayer) => sublayer.id === id)?.title ?? id
  );
  return titles.join(", ") || probe.title;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
