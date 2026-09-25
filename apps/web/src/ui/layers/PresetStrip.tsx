import { presentationLabel } from "../../i18n/presentation";
import { useEffect, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { t } from "../../i18n";
import { on } from "../../lib/events";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Icon, IconButton } from "../kit";
import { MAP_PRESETS } from "../presets";
import { nextPresetIndex } from "../presetNavigation";
import { categoryCountLabel } from "./layerPresentation";
import { showStatistics } from "../../statistics/explorerStore";
import {
  loadUserPresets,
  saveUserPresets,
  withoutUserPreset,
  type UserPreset
} from "../userPresets";

/** Four ready-made layer sets, as a horizontally scrollable row of cards (§4.7 ③).
 *
 *  A preset is a shortcut, not a mode: tapping the active one again releases it and leaves the
 *  categories exactly as they are, so the user can start from a preset and then adjust.
 */
export function PresetStrip() {
  const store = getMapStore();

  const activePresetId = useMapStoreSnapshot((s) => s.activePresetId);
  const stripRef = useRef<HTMLDivElement>(null);
  // Saved sets live in localStorage, which nothing re-renders on: the dialog announces a save
  // through the same signal the layer catalogue uses.
  const [userPresets, setUserPresets] = useState<UserPreset[]>(() => loadUserPresets());
  useEffect(() => on("layers-changed", () => setUserPresets(loadUserPresets())), []);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const strip = stripRef.current;
    if (!strip) return;
    const buttons = [...strip.querySelectorAll<HTMLButtonElement>("[data-preset-index]")];
    const next = nextPresetIndex(buttons.indexOf(event.target), event.key, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  };

  // A vertical wheel over a horizontal strip otherwise scrolls the whole drawer past it, which
  // makes the cards after the third one effectively unreachable with a mouse.
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    const strip = stripRef.current;
    if (!strip || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    strip.scrollLeft += event.deltaY;
  };

  return (
    <>
      <div
        ref={stripRef}
        className="preset-strip"
        data-testid="preset-strip"
        role="group"
        aria-label={t("layers.presets")}
        onKeyDown={navigate}
        onWheel={wheel}
      >
        {MAP_PRESETS.map((preset, index) => {
          const active = activePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              data-active={active || undefined}
              data-testid={`preset-${preset.id}`}
              data-preset-index={index}
              aria-pressed={active}
              title={presentationLabel("presetDescription", preset.id, preset.description)}
              onClick={() => {
                if (active) {
                  store.clearPreset();

                  return;
                }
                const undo = store.applyPreset(preset);
                if (preset.openStatistics) showStatistics(true);
                store.showToast(t("polish.applied"), {
                  action: { label: t("polish.undo"), onSelect: undo }
                });
              }}
            >
              <Icon name={preset.symbol} size={24} filled={active} />
              <span className="preset-card-name">
                {presentationLabel("preset", preset.id, preset.name)}
              </span>
              <span className="preset-card-meta">
                {categoryCountLabel(preset.categories?.length ?? 0)}
              </span>
            </button>
          );
        })}

        {/* The user's own sets sit in the same row as the built-in ones — they are the same kind
          of shortcut, and separating them would imply one is less real. */}
        {userPresets.map((preset, index) => {
          const active = activePresetId === preset.id;
          return (
            <div className="preset-card-wrap" key={preset.id}>
              <button
                type="button"
                className="preset-card"
                data-active={active || undefined}
                data-testid={`preset-${preset.id}`}
                data-preset-index={MAP_PRESETS.length + index}
                aria-pressed={active}
                onClick={() => {
                  if (active) {
                    store.clearPreset();
                    return;
                  }
                  const undo = store.applyPreset(preset);
                  store.showToast(t("polish.applied"), {
                    action: { label: t("polish.undo"), onSelect: undo }
                  });
                }}
              >
                <Icon name="bookmark" size={24} filled={active} />
                <span className="preset-card-name">
                  {presentationLabel("preset", preset.id, preset.name)}
                </span>
                <span className="preset-card-meta">
                  {t("presets.layerCount", { count: preset.layers.length })}
                </span>
              </button>
              <IconButton
                icon="close"
                label={t("presets.delete", { name: preset.name })}
                size="sm"
                className="preset-card-delete"
                testId={`preset-delete-${preset.id}`}
                onClick={() => {
                  const next = withoutUserPreset(loadUserPresets(), preset.id);
                  saveUserPresets(next);
                  setUserPresets(next);
                  if (active) store.clearPreset();
                }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
