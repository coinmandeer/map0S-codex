import { useMemo } from "react";
import type { FilterFacetV2, FilterValues } from "@mapos/layer-sdk";
import { Button, Chip, IconButton, Popover, RangeSlider, Slider, Switch, TextField } from "../kit";

/** Per-layer filters, rendered from the manifest rather than hand-written per layer (§4.7).
 *
 *  Every facet kind in the v1 and v2 schemas has exactly one control here, so a new layer gets
 *  a working filter UI by declaring facets — which is the whole point of the manifest being
 *  declarative. Unknown kinds are skipped instead of rendering a broken control.
 */
export function LayerFilterPopover({
  layerId,
  layerName,
  facets,
  values,
  onChange,
  onReset
}: {
  layerId: string;
  layerName: string;
  facets: readonly FilterFacetV2[];
  values: FilterValues;
  onChange: (patch: FilterValues) => void;
  onReset: () => void;
}) {
  const changed = useMemo(
    () => facets.some((facet) => hasNonDefaultValue(facet, values)),
    [facets, values]
  );

  return (
    <Popover
      title={`Filtr: ${layerName}`}
      side="left"
      align="start"
      width={288}
      testId={`layer-filter-${layerId}`}
      trigger={
        <IconButton
          icon="tune"
          label={`Filtr vrstvy ${layerName}`}
          size="sm"
          active={changed}
          testId={`layer-filter-btn-${layerId}`}
        />
      }
    >
      <div className="layer-filter-body">
        {facets.map((facet) => (
          <FacetControl
            key={facet.id}
            layerId={layerId}
            facet={facet}
            values={values}
            onChange={onChange}
          />
        ))}
        <Button
          variant="text"
          size="sm"
          icon="undo"
          disabled={!changed}
          onClick={onReset}
          testId={`layer-filter-reset-${layerId}`}
        >
          Zrušit filtr
        </Button>
      </div>
    </Popover>
  );
}

function FacetControl({
  layerId,
  facet,
  values,
  onChange
}: {
  layerId: string;
  facet: FilterFacetV2;
  values: FilterValues;
  onChange: (patch: FilterValues) => void;
}) {
  const testId = `filter-${layerId}-${facet.id}`;

  if (facet.kind === "toggle") {
    const on = values[facet.id] === true;
    return (
      <div className="layer-filter-row">
        <span className="layer-filter-label">{facet.label}</span>
        <Switch
          checked={on}
          label={facet.label}
          onChange={(next) => onChange({ [facet.id]: next })}
          testId={testId}
        />
      </div>
    );
  }

  if (facet.kind === "range" || facet.kind === "distance") {
    const min = facet.min ?? 0;
    const max = facet.max ?? 100;
    const step = facet.step ?? rangeStep(min, max);
    const current = numberOr(values[facet.id], numberOr(facet.default, min));
    return (
      <Slider
        label={facet.label}
        min={min}
        max={max}
        step={step}
        value={clamp(current, min, max)}
        format={(value) => formatNumber(value)}
        onChange={(next) => onChange({ [facet.id]: next })}
        testId={testId}
      />
    );
  }

  if (facet.kind === "date-range") {
    const [from, to] = pair(values[facet.id]);
    return (
      <RangeSlider
        label={facet.label}
        min={facet.min ?? 0}
        max={facet.max ?? 30}
        value={[from ?? facet.min ?? 0, to ?? facet.max ?? 30]}
        format={([a, b]) => `${formatNumber(a)}–${formatNumber(b)} dní`}
        onChange={(next) => onChange({ [facet.id]: next })}
        testId={testId}
      />
    );
  }

  if (facet.kind === "text") {
    return (
      <TextField
        label={facet.label}
        value={typeof values[facet.id] === "string" ? (values[facet.id] as string) : ""}
        onChange={(event) => onChange({ [facet.id]: event.target.value })}
        testId={testId}
      />
    );
  }

  if (!facet.options?.length) return null;

  const selected = asStringArray(values[facet.id] ?? facet.default);
  const single = facet.kind === "single-select";

  return (
    <div className="layer-filter-facet">
      <span className="layer-filter-label">{facet.label}</span>
      <div className="layer-filter-chips" data-testid={testId}>
        {facet.options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <Chip
              key={option.id}
              label={option.label}
              active={active}
              testId={`${testId}-${option.id}`}
              onClick={() =>
                onChange({
                  [facet.id]: single
                    ? active
                      ? null
                      : option.id
                    : active
                      ? selected.filter((id) => id !== option.id)
                      : [...selected, option.id]
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/** True when the user has moved a facet away from what the manifest asked for. Drives the
 *  active state on the `tune` button so a filtered layer is visible from the row. */
export function hasNonDefaultValue(facet: FilterFacetV2, values: FilterValues): boolean {
  const value = values[facet.id];
  if (value === undefined || value === null) return false;
  const fallback = facet.default;
  if (Array.isArray(value) && Array.isArray(fallback)) {
    return (
      value.length !== fallback.length || value.some((item, index) => item !== fallback[index])
    );
  }
  if (fallback === undefined) return facet.kind === "toggle" ? value === true : true;
  return value !== fallback;
}

function rangeStep(min: number, max: number): number {
  const span = max - min;
  if (span <= 2) return 0.1;
  if (span <= 20) return 1;
  return Math.max(1, Math.round(span / 60));
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pair(value: unknown): [number | null, number | null] {
  if (Array.isArray(value) && value.length === 2) {
    return [numberOrNull(value[0]), numberOrNull(value[1])];
  }
  return [null, null];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}
