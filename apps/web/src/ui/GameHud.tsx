import { useEffect, useRef, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { t } from "../i18n/cs";
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
import {
  Accordion,
  Button,
  IconButton,
  InfoTip,
  ListItem,
  Popover,
  ProgressLinear,
  SegmentedButton,
  Switch,
  type AccordionSection
} from "./kit";

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
  lng: number;
  lat: number;
  zoneKind: "standard" | "event" | "staker_gate";
  lifecycle: "active" | "scheduled" | "expired";
  startsInSeconds: number | null;
  endsInSeconds: number | null;
  minStakeUsd: number;
}

const GAMES = [
  { id: "aavegotchi", label: "Aavegotchi", icon: "casino" },
  { id: "trail-signals", label: "Trail Signals", icon: "hiking" }
] as const;

/** XP per level, shared with the Personal panel's rank line. */
const XP_PER_LEVEL = 100;

const ZONE_COLORS: Record<GameZone["zoneKind"], string> = {
  standard: "var(--accent)",
  event: "var(--warning)",
  staker_gate: "var(--info)"
};

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

/** The game panel (§4.6).
 *
 *  Player, today's field, zones and quests — in that order, because that is the order a player
 *  asks about them. Everything that is a setting rather than a status lives behind the header's
 *  settings popover or the "Pokročilé" section, so the panel is not a wall of toggles.
 */
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

  const focusGame = (gameId: string) => {
    if (!activeGames.includes(gameId)) {
      store.setActiveGames([...activeGames, gameId], gameId);
      return;
    }
    store.setFocusedGame(gameId);
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

  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const gotchiEnabled = GAME_AVATAR_V2_ENABLED && Boolean(inventory?.items[0]);

  const advanced: AccordionSection[] = [
    {
      id: "advanced",
      title: "Pokročilé",
      icon: "tune",
      testId: "game-advanced",
      children: (
        <div className="game-advanced">
          <div className="game-advanced-block">
            <span className="kit-eyebrow">Přístupné ovládání</span>
            <AccessibleGameDpad />
          </div>
          <div className="game-advanced-block">
            <span className="kit-eyebrow">Výkon</span>
            <SegmentedButton<GamePerformanceTier>
              ariaLabel="Výkonnostní profil hry"
              value={performanceTier}
              onChange={changePerformanceTier}
              block
              options={[
                { value: "low", label: "Úsporný" },
                { value: "balanced", label: "Vyvážený" }
              ]}
              testId="game-performance"
            />
            <InfoTip title="Úsporný profil">
              Omezuje animace na 24 fps, vypne halo orbů a nikdy nevolí LOD0.
            </InfoTip>
          </div>
          {session && staking && (
            <div className="game-advanced-block" data-testid="game-staking">
              <span className="kit-eyebrow">Experimentální ekonomika</span>
              <p className="game-note">
                Vloženo ${staking.stakedUsd.toFixed(2)} · úroveň {staking.tier} · výnos $
                {staking.pendingYieldUsd.toFixed(4)}
              </p>
              <div className="game-advanced-actions">
                <Button variant="outlined" size="sm" onClick={() => void stake(10)}>
                  +10 USD
                </Button>
                <Button variant="outlined" size="sm" onClick={() => void stake(100)}>
                  +100 USD
                </Button>
              </div>
            </div>
          )}
        </div>
      )
    }
  ];

  return (
    <PanelShell
      title={t("mode.game")}
      testId="game-panel"
      className="game-panel"
      headerExtra={
        <Popover
          title="Nastavení hry"
          testId="game-settings"
          width={300}
          trigger={<IconButton icon="settings" label="Nastavení hry" size="sm" />}
        >
          <div className="game-settings">
            <div className="game-settings-field">
              <span className="kit-eyebrow">
                Pohyb
                <InfoTip title="Poloha" testId="game-position-status">
                  {trackingMode === "gps"
                    ? gpsAccuracy == null
                      ? "Reálná poloha: zaměřuji GPS."
                      : `Reálná poloha ±${Math.round(gpsAccuracy)} m; přesná poloha se nesdílí.`
                    : "Simulovaná poloha: start je střed mapy, nejde o tvrzení skutečné GPS."}
                </InfoTip>
              </span>
              <SegmentedButton<"simulation" | "gps">
                ariaLabel="Pohyb hráče"
                value={trackingMode}
                onChange={(next) => store.setGameTrackingMode(next)}
                block
                options={[
                  { value: "simulation", label: "Klávesy" },
                  { value: "gps", label: "GPS" }
                ]}
                testId="game-tracking"
              />
            </div>
            <div className="game-settings-field">
              <span className="kit-eyebrow">Kamera</span>
              <SegmentedButton<"follow" | "top">
                ariaLabel="Kamera"
                value={cameraMode}
                onChange={(next) => store.setGameCameraMode(next)}
                block
                options={[
                  { value: "follow", label: "Za hráčem" },
                  { value: "top", label: "Shora" }
                ]}
                testId="game-camera"
              />
            </div>
            <div className="game-settings-field">
              <span className="kit-eyebrow">
                Avatar
                <InfoTip title="Avatar" testId="avatar-asset-gate">
                  {!GAME_AVATAR_V2_ENABLED
                    ? "Nové 3D avatary jsou vypnuté bezpečným rollback přepínačem."
                    : (inventory?.message ?? "Načítám bezpečný lokální inventář.")}
                </InfoTip>
              </span>
              <SegmentedButton<"cube" | "gotchi">
                ariaLabel="Avatar hráče"
                value={GAME_AVATAR_V2_ENABLED && avatarStyle === "aavegotchi" ? "gotchi" : "cube"}
                onChange={(next) => {
                  if (next === "cube") {
                    store.setAvatarStyle("cube");
                    return;
                  }
                  if (inventory) selectInventoryItem(inventory, 0);
                }}
                block
                options={[
                  { value: "cube", label: "Kostka" },
                  { value: "gotchi", label: "Gotchi", disabled: !gotchiEnabled }
                ]}
                testId="avatar"
              />
            </div>
            <div className="game-settings-field">
              <span className="kit-eyebrow">Aktivní hry</span>
              {GAMES.map((game) => (
                <span className="game-settings-game" key={game.id}>
                  <span>{game.label}</span>
                  <Switch
                    checked={activeGames.includes(game.id)}
                    label={game.label}
                    testId={`game-active-${game.id}`}
                    onChange={() => toggleGame(game.id)}
                  />
                </span>
              ))}
            </div>
          </div>
        </Popover>
      }
    >
      <div className="game-hud" data-testid="game-hud">
        <section className="game-player">
          <span className="game-avatar" aria-hidden>
            {(session?.displayName ?? "G").slice(0, 1).toLocaleUpperCase("cs")}
          </span>
          <span className="game-player-copy">
            <span className="game-player-name">{session?.displayName ?? "Gotchi #0"}</span>
            <span className="game-player-rank" data-testid="game-rank">
              Lvl {level} · {xp} XP
            </span>
            <ProgressLinear
              value={(xp % XP_PER_LEVEL) / XP_PER_LEVEL}
              label={`Postup na úroveň ${level + 1}`}
            />
          </span>
          {session?.isGuest && (
            <Button
              variant="text"
              size="sm"
              icon="account_balance_wallet"
              testId="game-wallet-login"
              onClick={() => store.showToast("Přihlášení peněženkou připravujeme")}
            >
              Peněženka
            </Button>
          )}
        </section>

        <SegmentedButton<string>
          ariaLabel="Sledovaná hra"
          value={focusedGame}
          onChange={focusGame}
          block
          options={GAMES.map((game) => ({
            value: game.id,
            label: game.label,
            icon: game.icon
          }))}
          testId="game-selector"
        />

        <section className="game-field">
          <span className="game-field-value" data-testid="orb-count">
            {orbs.collected} / {orbs.total}
          </span>
          <span className="game-field-label">sebráno dnes</span>
          <ProgressLinear
            value={orbs.total ? orbs.collected / orbs.total : 0}
            label="Sebráno z denního pole"
          />
          <p className="game-note">
            {orbs.total
              ? `Sektor 1 × 1 km · zbývá ${orbs.remaining} · obnova o půlnoci`
              : "Čekám na silniční data pro denní pole"}
          </p>
        </section>

        <div className="game-counters">
          <span className="game-counter">
            <span className="game-counter-value">{caught}</span>
            <span className="game-counter-label">duchů</span>
          </span>
          <span className="game-counter">
            <span className="game-counter-value">{encounters}</span>
            <span className="game-counter-label">soubojů</span>
          </span>
        </div>

        {zones.length > 0 && (
          <section className="game-section" data-testid="game-zones">
            <span className="kit-eyebrow">Zóny</span>
            {zones.map((zone) => (
              <ListItem
                key={zone.id}
                testId={`game-zone-${zone.id}`}
                icon="trip_origin"
                iconColor={ZONE_COLORS[zone.zoneKind]}
                title={zone.name}
                subtitle={`${zoneKindLabel(zone.zoneKind)} · ${zoneTimeLabel(zone)}${
                  zone.zoneKind === "staker_gate" ? ` · $${zone.minStakeUsd}` : ""
                }`}
                trailing={
                  <IconButton
                    icon="near_me"
                    label={`Zaměřit ${zone.name}`}
                    size="sm"
                    onClick={() => emit("fly-to", { lng: zone.lng, lat: zone.lat, zoom: 15 })}
                  />
                }
              />
            ))}
          </section>
        )}

        {quests.length > 0 && (
          <section className="game-section" data-testid="game-quests">
            <span className="kit-eyebrow">Questy</span>
            {quests.map((quest) => {
              const done = completed.has(quest.id);
              return (
                <ListItem
                  key={quest.id}
                  testId={`quest-${quest.id}`}
                  icon="flag"
                  title={quest.title}
                  subtitle={quest.anchorName ?? undefined}
                  disabled={done}
                  onClick={() => void claimQuest(quest)}
                  trailing={
                    <span className="game-quest-reward" data-done={done || undefined}>
                      {done ? "hotovo" : `+${quest.rewardPoints} XP`}
                    </span>
                  }
                />
              );
            })}
          </section>
        )}

        <Accordion sections={advanced} testId="game-accordion" />
      </div>
    </PanelShell>
  );
}
