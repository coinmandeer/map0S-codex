import { useEffect, useRef, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { loadOrbXp, persistOrbXp } from "../layers/game/orbsController";
import {
  persistAvatarInventorySelection,
  placeholderAvatarInventoryProvider,
  type AvatarInventoryResult
} from "../layers/game/avatarInventory";
import {
  defaultGamePerformanceTier,
  persistGamePerformanceTier
} from "../layers/game/gamePerformance";
import type { GamePerformanceTier } from "../layers/game/avatarAssets";
import { API_BASE, ApiError, apiGetSafe, apiPost } from "../lib/api";
import { emit, on } from "../lib/events";
import { GAME_AVATAR_V2_ENABLED } from "../lib/featureFlags";
import { AccessibleGameDpad } from "./GameControls";
import { PanelShell } from "./PanelShell";

type Bbox = [number, number, number, number];

interface StakingOverview {
  stakedUsd: number;
  pendingYieldUsd: number;
  totalQuestRewardsUsd: number;
  tier: string;
  apy: number;
}

interface GameQuest {
  id: string;
  title: string;
  rewardPoints: number;
  /** Quests derived from a real place are claimable only on site; seeded ones are not. */
  anchored?: boolean;
  anchorName?: string;
}

interface GameZone {
  id: string;
  name: string;
  zoneKind: "standard" | "event" | "staker_gate";
  lifecycle: "active" | "scheduled" | "expired";
  startsInSeconds: number | null;
  endsInSeconds: number | null;
  minStakeUsd: number;
}

function zoneKindLabel(kind: GameZone["zoneKind"]): string {
  if (kind === "event") return "Událost";
  if (kind === "staker_gate") return "Stake brána";
  return "Průzkum";
}

function zoneTimeLabel(zone: GameZone): string {
  const seconds = zone.lifecycle === "scheduled" ? zone.startsInSeconds : zone.endsInSeconds;
  if (seconds === null) return zone.lifecycle === "scheduled" ? "plánovaná" : "aktivní";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const value = minutes >= 60 ? `${Math.ceil(minutes / 60)} h` : `${minutes} min`;
  return zone.lifecycle === "scheduled" ? `za ${value}` : `zbývá ${value}`;
}

/** Quest anchors are things to walk to, so the list is drawn from a walkable radius around the
 *  player rather than from whatever the camera happens to frame. */
const QUEST_RADIUS_DEG = 0.05;

export function GameHud() {
  const store = getMapStore();
  const open = useMapStoreSnapshot((s) => s.sidebarOpen);
  const mode = useMapStoreSnapshot((s) => s.mode);
  const session = useMapStoreSnapshot((s) => s.session);
  const trackingMode = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const cameraMode = useMapStoreSnapshot((s) => s.gameCameraMode);
  const avatarStyle = useMapStoreSnapshot((s) => s.avatarStyle);
  const activeGames = useMapStoreSnapshot((s) => s.activeGameIds);
  const focusedGame = useMapStoreSnapshot((s) => s.focusedGameId);
  const [inventory, setInventory] = useState<AvatarInventoryResult | null>(null);
  const [performanceTier, setPerformanceTier] = useState<GamePerformanceTier>(() =>
    defaultGamePerformanceTier()
  );
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [caught, setCaught] = useState(0);
  const [encounters, setEncounters] = useState(0);
  // Counts follow the signed-in player, since the dots themselves do.
  const orbOwner = session?.id ?? "anon";
  const [orbs, setOrbs] = useState({ collected: 0, total: 0, remaining: 0 });
  const [xp, setXp] = useState(() => Math.max(loadOrbXp(orbOwner), session?.xpTotal ?? 0));
  const [quests, setQuests] = useState<GameQuest[]>([]);
  const [zones, setZones] = useState<GameZone[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [staking, setStaking] = useState<StakingOverview | null>(null);
  const playerRef = useRef<{ lng: number; lat: number } | null>(null);
  // The layer may publish its first position before React has attached this HUD listener. Seed
  // the first request from the current view so Prague never briefly lists curated Plzeň zones.
  const [questArea, setQuestArea] = useState<Bbox>(() => [
    store.view.lng - QUEST_RADIUS_DEG,
    store.view.lat - QUEST_RADIUS_DEG,
    store.view.lng + QUEST_RADIUS_DEG,
    store.view.lat + QUEST_RADIUS_DEG
  ]);

  useEffect(() => {
    // Signing in mid-session swaps whose dots these are, so the counters have to follow.
    setOrbs({ collected: 0, total: 0, remaining: 0 });
    setXp(Math.max(loadOrbXp(orbOwner), session?.xpTotal ?? 0));
  }, [orbOwner, session?.xpTotal]);

  useEffect(() => {
    const offs = [
      on("ghost-caught", () => setCaught((c) => c + 1)),
      on("encounter-resolved", () => setEncounters((c) => c + 1)),
      on("orbs-collected", (detail) => {
        if (typeof detail?.xp === "number") setXp(detail.xp);
      }),
      on("orb-field-updated", ({ collected, total, remaining }) => {
        setOrbs({ collected, total, remaining });
      }),
      on("game-progress-synced", ({ xpTotal }) => {
        setXp(xpTotal);
      }),
      on("game-controller-status", ({ gpsAccuracyM }) => setGpsAccuracy(gpsAccuracyM)),
      on("geolocation", ({ lng, lat }) => {
        playerRef.current = { lng, lat };
        // Refetching on every position tick would hammer the endpoint; a new area is only
        // needed once the player has left the one the quests were fetched for.
        setQuestArea((current) =>
          current &&
          lng > current[0] + 0.01 &&
          lng < current[2] - 0.01 &&
          lat > current[1] + 0.01 &&
          lat < current[3] - 0.01
            ? current
            : [
                lng - QUEST_RADIUS_DEG,
                lat - QUEST_RADIUS_DEG,
                lng + QUEST_RADIUS_DEG,
                lat + QUEST_RADIUS_DEG
              ]
        );
      })
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    if (!open || mode !== "game") return;
    const controller = new AbortController();
    void placeholderAvatarInventoryProvider
      .list(controller.signal)
      .then(setInventory)
      .catch(() => setInventory(null));
    return () => controller.abort();
  }, [mode, open]);

  useEffect(() => {
    if (mode === "game") emit("game-performance-changed", { tier: performanceTier });
  }, [mode, performanceTier]);

  useEffect(() => {
    const query = `?bbox=${questArea.map((n) => n.toFixed(4)).join(",")}`;
    void apiGetSafe<{ zones?: GameZone[]; quests?: GameQuest[]; completedQuestIds?: string[] }>(
      `/game/zones${query}`,
      { auth: true }
    ).then((data) => {
      setZones((data?.zones ?? []).filter((zone) => zone.lifecycle !== "expired").slice(0, 3));
      setQuests((data?.quests ?? []).slice(0, 5));
      setCompleted(new Set(data?.completedQuestIds ?? []));
    });
  }, [session, questArea]);

  const claimQuest = async (quest: GameQuest) => {
    // An anchored quest is verified server-side against the anchor's own coordinates, so the
    // claim carries where the player is; without a fix there is nothing to verify against.
    if (quest.anchored && !playerRef.current) {
      store.showToast("Zapni GPS nebo se pohni, ať víme, kde jsi");
      return;
    }
    try {
      const result = await apiPost<{ rewardPoints: number; xpTotal?: number }>(
        `/game/quests/${quest.id}/complete`,
        playerRef.current ?? undefined
      );
      setCompleted((prev) => new Set(prev).add(quest.id));
      setXp((current) => {
        const total = result.xpTotal ?? current + result.rewardPoints;
        persistOrbXp(orbOwner, total);
        return total;
      });
      store.showToast(`Quest splněn · +${result.rewardPoints} XP`);
    } catch (err) {
      store.showToast(err instanceof ApiError ? err.message : "Quest se nepodařilo dokončit");
    }
  };

  useEffect(() => {
    if (!session) {
      setStaking(null);
      return;
    }
    fetch(`${API_BASE}/game/staking/overview`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setStaking(data?.staking ?? null))
      .catch(() => setStaking(null));
  }, [session]);

  const stake = async (amount: number) => {
    const res = await fetch(`${API_BASE}/game/staking/stake`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountUsd: amount })
    });
    if (res.ok) {
      const data = await res.json();
      setStaking(data.staking);
      store.showToast(`Stake +$${amount}`);
    }
  };

  const toggleGame = (gameId: string) => {
    const next = activeGames.includes(gameId)
      ? activeGames.filter((id) => id !== gameId)
      : [...activeGames, gameId];
    if (!next.length) {
      store.showToast("Alespoň jedna hra musí zůstat aktivní");
      return;
    }
    store.setActiveGames(next, next.includes(focusedGame) ? focusedGame : next[0]);
  };

  const selectInventoryItem = (result: AvatarInventoryResult, index: number) => {
    const item = result.items[index];
    if (!item || item.status !== "available") return;
    persistAvatarInventorySelection(item.selection);
    // Keep the old store field/event alive for rollback consumers, then send the richer selection
    // through the renderer-neutral inventory boundary.
    store.setAvatarStyle("aavegotchi");
    emit("avatar-inventory-selected", { selection: item.selection });
  };

  const changePerformanceTier = (tier: GamePerformanceTier) => {
    persistGamePerformanceTier(tier);
    setPerformanceTier(tier);
    emit("game-performance-changed", { tier });
  };

  if (!open || mode !== "game") return null;

  return (
    <PanelShell title="Hra" testId="game-panel" className="game-panel">
      <div className="game-hud" data-testid="game-hud">
        <div className="game-hud-title">
          <strong>
            {focusedGame === "trail-signals" ? "Trail Signals" : "Aavegotchi výprava"}
          </strong>
          <span>{xp} XP</span>
        </div>
        <div className="game-hud-games" data-testid="game-selector">
          {[
            { id: "aavegotchi", label: "Aavegotchi" },
            { id: "trail-signals", label: "Trail Signals" }
          ].map((game) => {
            const active = activeGames.includes(game.id);
            return (
              <div key={game.id} className={active ? "active" : ""}>
                <button type="button" onClick={() => active && store.setFocusedGame(game.id)}>
                  {game.label}
                </button>
                <button
                  type="button"
                  aria-label={`${active ? "Vypnout" : "Zapnout"} ${game.label}`}
                  onClick={() => toggleGame(game.id)}
                >
                  {active ? "✓" : "+"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="game-hud-row">
          <span className="game-hud-count" data-testid="orb-count">
            🔮 dnes {orbs.collected}/{orbs.total}
          </span>
          <span className="game-hud-count">👻 {caught}</span>
          <span className="game-hud-count">⚔️ {encounters}</span>
        </div>
        <span className="meta game-hud-sector-note">
          {orbs.total
            ? `Pevné denní pole 1 × 1 km · zbývá ${orbs.remaining}`
            : "Čekám na silniční data pro denní pole…"}
        </span>
        <div className="game-hud-controls">
          <button
            className={`btn small ${trackingMode === "simulation" ? "btn-accent" : ""}`}
            onClick={() => store.setGameTrackingMode("simulation")}
          >
            Klávesy
          </button>
          <button
            className={`btn small ${trackingMode === "gps" ? "btn-accent" : ""}`}
            onClick={() => store.setGameTrackingMode("gps")}
          >
            GPS
          </button>
          <button
            className={`btn small ${cameraMode === "follow" ? "btn-accent" : ""}`}
            onClick={() => store.setGameCameraMode("follow")}
          >
            Za hráčem
          </button>
          <button
            className={`btn small ${cameraMode === "top" ? "btn-accent" : ""}`}
            onClick={() => store.setGameCameraMode("top")}
          >
            Shora
          </button>
        </div>
        <span className="meta" data-testid="game-position-status">
          {trackingMode === "gps"
            ? gpsAccuracy == null
              ? "Reálná poloha: zaměřuji GPS…"
              : `Reálná poloha ±${Math.round(gpsAccuracy)} m; přesná poloha se nesdílí.`
            : "Simulovaná poloha: start je střed mapy, nejde o tvrzení skutečné GPS."}
        </span>
        <details className="game-hud-movement">
          <summary>Přístupné ovládání bez gesta</summary>
          <AccessibleGameDpad />
        </details>
        <details className="game-hud-avatar">
          <summary>Avatar a inventář</summary>
          <div className="game-hud-controls">
            <button
              className={`btn small ${!GAME_AVATAR_V2_ENABLED || avatarStyle === "cube" ? "btn-accent" : ""}`}
              onClick={() => store.setAvatarStyle("cube")}
              data-testid="avatar-cube"
            >
              Původní postava
            </button>
            <button
              className={`btn small ${GAME_AVATAR_V2_ENABLED && avatarStyle === "aavegotchi" ? "btn-accent" : ""}`}
              onClick={() => inventory && selectInventoryItem(inventory, 0)}
              disabled={!GAME_AVATAR_V2_ENABLED || !inventory?.items[0]}
              data-testid="avatar-gotchi"
            >
              Neutrální 3D
            </button>
          </div>
          <p className="meta" data-testid="avatar-asset-gate">
            {!GAME_AVATAR_V2_ENABLED
              ? "Nové 3D avatary jsou vypnuté bezpečným rollback přepínačem."
              : (inventory?.message ?? "Načítám bezpečný lokální inventář…")}
          </p>
          {inventory?.items.map((item) => (
            <p className="meta" key={item.selection.inventoryItemId}>
              {item.selection.displayName}: {item.description}
            </p>
          ))}
        </details>
        <details className="game-hud-performance">
          <summary>Výkon a animace</summary>
          <div className="game-hud-controls" role="group" aria-label="Výkonnostní profil hry">
            <button
              type="button"
              className={`btn small ${performanceTier === "low" ? "btn-accent" : ""}`}
              aria-pressed={performanceTier === "low"}
              onClick={() => changePerformanceTier("low")}
            >
              Úsporný
            </button>
            <button
              type="button"
              className={`btn small ${performanceTier === "balanced" ? "btn-accent" : ""}`}
              aria-pressed={performanceTier === "balanced"}
              onClick={() => changePerformanceTier("balanced")}
            >
              Vyvážený
            </button>
          </div>
          <p className="meta">
            Úsporný profil omezuje animace na 24 fps, vypne halo orbů a nikdy nevolí LOD0.
          </p>
        </details>
        {zones.length > 0 && (
          <div className="game-hud-zones" data-testid="game-zones">
            <div className="meta">Časované zóny</div>
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="game-hud-zone"
                data-kind={zone.zoneKind}
                data-lifecycle={zone.lifecycle}
              >
                <span className="game-hud-zone-dot" aria-hidden="true" />
                <span className="game-hud-zone-name">{zone.name}</span>
                <span className="meta">
                  {zoneKindLabel(zone.zoneKind)} · {zoneTimeLabel(zone)}
                  {zone.zoneKind === "staker_gate" ? ` · $${zone.minStakeUsd}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {quests.length > 0 && (
          <div className="game-hud-quests">
            <div className="meta">Questy</div>
            {quests.map((q) => {
              const done = completed.has(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  className="game-hud-quest"
                  data-done={done || undefined}
                  data-testid={`quest-${q.id}`}
                  disabled={done}
                  onClick={() => void claimQuest(q)}
                >
                  <span>{q.title}</span>
                  <span className="meta">{done ? "hotovo" : `+${q.rewardPoints} XP`}</span>
                </button>
              );
            })}
          </div>
        )}
        {session && staking && (
          <details className="game-hud-stake">
            <summary>Experimentální ekonomika</summary>
            <div className="meta">
              Vloženo ${staking.stakedUsd.toFixed(2)} · úroveň {staking.tier} · výnos $
              {staking.pendingYieldUsd.toFixed(4)}
            </div>
            <div className="game-hud-controls">
              <button className="btn small" onClick={() => void stake(10)}>
                +10 USD
              </button>
              <button className="btn small" onClick={() => void stake(100)}>
                +100 USD
              </button>
            </div>
          </details>
        )}
        <span className="meta">WASD/šipky pro pohyb · klikni na ducha nebo souboj</span>
      </div>
    </PanelShell>
  );
}
