import { useRef, type KeyboardEvent, type WheelEvent } from "react";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Icon } from "../kit";
import { MAP_PRESETS } from "../presets";
import { nextPresetIndex } from "../presetNavigation";
import { categoryCountLabel } from "./layerPresentation";

/** Four ready-made layer sets, as a horizontally scrollable row of cards (§4.7 ③).
 *
 *  A preset is a shortcut, not a mode: tapping the active one again releases it and leaves the
 *  categories exactly as they are, so the user can start from a preset and then adjust.
 */
export function PresetStrip() {
  const store = getMapStore();
  const activePresetId = useMapStoreSnapshot((s) => s.activePresetId);
  const stripRef = useRef<HTMLDivElement>(null);

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
    <div
      ref={stripRef}
      className="preset-strip"
      data-testid="preset-strip"
      role="group"
      aria-label="Presety vrstev"
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
            title={preset.description}
            onClick={() => {
              if (active) {
                store.clearPreset();
                store.showToast("Preset vypnutý, výběr kategorií zůstal");
                return;
              }
              store.applyPreset(preset);
              store.showToast(preset.description);
            }}
          >
            <Icon name={preset.symbol} size={24} filled={active} />
            <span className="preset-card-name">{preset.name}</span>
            <span className="preset-card-meta">
              {categoryCountLabel(preset.categories?.length ?? 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
