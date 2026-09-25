import { useEffect, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { getShellStore } from "../store/shellStore";
import { useWorld, worldRuntime } from "./runtime";
import { GameSwitcher } from "./GameSwitcher";
import { emit, on } from "../lib/events";
import { st } from "../statistics/labels";
import type { WorldPosition } from "@mapos/layer-sdk";
import "./gameHud.css";

function distanceM(a: WorldPosition, b: WorldPosition): number {
  const rad = Math.PI / 180;
  return Math.hypot(
    (a.lng - b.lng) * 111320 * Math.cos((a.lat * rad + b.lat * rad) / 2),
    (a.lat - b.lat) * 111320
  );
}

function countdown(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.max(1, Math.round(seconds))} s`;
}

/** The arcade HUD (game mode only).
 *
 *  A floating overlay, not the map panel: the reader gets the board, the clock and the three
 *  actions without opening anything, and the full quest/inventory panel stays one button away.
 *  Every action resolves through the same nearest-target path as the keyboard, so mouse, thumb
 *  and Space/Q behave identically. */
export function GameHudOverlay() {
  const mode = useMapStoreSnapshot((s) => s.mode);
  const tracking = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const camera = useMapStoreSnapshot((s) => s.gameCameraMode);
  const sidebarOpen = useMapStoreSnapshot((s) => s.sidebarOpen);
  const state = useWorld();
  const [, setTick] = useState(0);
  // The practice board publishes its orb count; the arcade HUD shows it without opening the panel.
  const [orbs, setOrbs] = useState(0);
  useEffect(() => on("game-practice", (payload) => setOrbs(payload?.orbs ?? 0)), []);
  useEffect(() => {
    if (mode !== "game") return;
    const timer = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, [mode]);
  if (mode !== "game") return null;

  const store = getMapStore();
  const shell = getShellStore();
  const snapshot = state.snapshot;
  const now = Date.now();
  const player = snapshot?.gamePosition ?? snapshot?.position;
  const coins = snapshot?.progress.coins ?? 0;
  const zone = player
    ? ([...(snapshot?.zones ?? [])]
        .map((item) => ({ item, distance: distanceM(player, item) }))
        .sort((a, b) => a.distance - b.distance)[0]?.item ?? null)
    : null;
  const zoneSeconds =
    zone?.lifecycle === "scheduled" ? zone.startsInSeconds : (zone?.endsInSeconds ?? null);
  const target = snapshot?.entities.find((entity) => entity.id === state.targetId) ?? null;
  const shootReady = Math.max(0, Math.ceil(((snapshot?.shootReadyAt ?? 0) - now) / 1000));
  const castReady = Math.max(0, Math.ceil(((snapshot?.castReadyAt ?? 0) - now) / 1000));
  const level = snapshot ? Math.floor(snapshot.progress.xp / 100) + 1 : 1;
  const connection =
    tracking === "simulation" && !state.connected
      ? st("Volný průzkum", "Free roam")
      : state.connected
        ? st("Živě", "Live")
        : st("Připojuji", "Connecting");

  return (
    <div className="game-hud-overlay" data-testid="game-hud">
      <div className="game-hud-card world-ui">
        <header className="game-hud-head">
          <span
            className={`game-hud-dot ${state.connected ? "is-online" : ""}`}
            aria-hidden="true"
          />
          <strong>{connection}</strong>
          <span className="game-hud-spacer" />
          <button
            type="button"
            className="game-hud-icon"
            title={st("Herní panel", "Game panel")}
            aria-pressed={sidebarOpen}
            data-testid="game-hud-panel"
            onClick={() =>
              sidebarOpen
                ? shell.closeLeftContext()
                : shell.openLeftContext({ type: "mode", mode: "game" })
            }
          >
            ☰
          </button>
        </header>

        <div className="game-hud-world">
          <GameSwitcher />
        </div>

        <div className="game-hud-vitals">
          <span>
            {st("Úroveň", "Level")} <strong>{level}</strong>
          </span>
          <span>
            XP <strong>{snapshot?.progress.xp ?? 0}</strong>
          </span>
          <span>
            {st("Mince", "Coins")} <strong data-testid="game-hud-coins">{coins}</strong>
          </span>
          <span>
            {st("Orby", "Orbs")} <strong data-testid="orb-count">{orbs}</strong>
          </span>
          <span>
            HP{" "}
            <strong className={snapshot && snapshot.hp <= 30 ? "is-low" : undefined}>
              {snapshot?.hp ?? 100}
            </strong>
          </span>
        </div>

        {snapshot && <progress max={snapshot.maxHp} value={snapshot.hp} />}

        {zone && (
          <p className="game-hud-zone" data-testid="game-hud-zone">
            <span className="game-hud-zone-dot" data-kind={zone.zoneKind} aria-hidden="true" />
            {zone.name} ·{" "}
            {zone.lifecycle === "scheduled" ? st("start za", "starts in") : st("zbývá", "left")}{" "}
            <strong>{zoneSeconds == null ? "—" : countdown(zoneSeconds)}</strong>
          </p>
        )}

        {target && (
          <p className="game-hud-target" data-testid="game-hud-target">
            <strong>{target.name}</strong>
            {target.maxHp > 0 && (
              <span>
                {" "}
                {target.hp}/{target.maxHp} HP
              </span>
            )}
            {player && <span> · {Math.round(distanceM(player, target))} m</span>}
          </p>
        )}

        {state.error && <p className="game-hud-error">{state.error}</p>}

        <div className="game-hud-actions">
          <button
            type="button"
            className="game-hud-action"
            data-testid="game-hud-collect"
            onClick={() => emit("game-action-nearest", { type: "collect" })}
          >
            ✦ {st("Sebrat", "Pick up")}
            <kbd>E</kbd>
          </button>
          <button
            type="button"
            className="game-hud-action"
            data-testid="game-hud-shoot"
            disabled={shootReady > 0}
            onClick={() => emit("game-action-nearest", { type: "shoot" })}
          >
            ◈ {st("Útok", "Attack")}
            <kbd>␣</kbd>
            {shootReady > 0 && <em>{shootReady}</em>}
          </button>
          <button
            type="button"
            className="game-hud-action is-spell"
            data-testid="game-hud-cast"
            disabled={castReady > 0}
            onClick={() => emit("game-action-nearest", { type: "cast" })}
          >
            🔥 {st("Fireball", "Fireball")}
            <kbd>Q</kbd>
            {castReady > 0 && <em>{castReady}</em>}
          </button>
        </div>

        <div className="game-hud-settings">
          <select
            aria-label={st("Pohyb", "Movement")}
            value={tracking}
            data-testid="game-hud-tracking"
            onChange={(event) =>
              store.setGameTrackingMode(event.target.value === "gps" ? "gps" : "simulation")
            }
          >
            <option value="simulation">{st("Šipky / WASD", "Arrows / WASD")}</option>
            <option value="gps">GPS</option>
          </select>
          <button
            type="button"
            className="game-hud-icon"
            title={st("Kamera", "Camera")}
            data-testid="game-hud-camera"
            onClick={() => store.setGameCameraMode(camera === "follow" ? "top" : "follow")}
          >
            {camera === "follow" ? "🎥" : "🛰"}
          </button>
          <button
            type="button"
            className="game-hud-icon"
            title={st("Vycentrovat", "Recenter")}
            data-testid="game-hud-recenter"
            onClick={() => emit("game-recenter")}
          >
            ◎
          </button>
          <button
            type="button"
            className="game-hud-icon"
            title={st("Trollbox", "Trollbox")}
            data-testid="game-hud-social"
            onClick={() => worldRuntime.openSocial()}
          >
            💬
          </button>
        </div>

        <p className="game-hud-hint">
          {st(
            "Šipky nebo WASD pohybují avatarem · Shift zrychlí · klikni na objekt a seber ho",
            "Arrows or WASD move the avatar · Shift sprints · click an object to pick it up"
          )}
        </p>
      </div>
    </div>
  );
}
