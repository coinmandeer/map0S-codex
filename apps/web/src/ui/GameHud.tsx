import { useEffect, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { loadCollectedOrbIds, loadOrbXp } from "../layers/game/orbsController";
import { API_BASE, ApiError, apiGetSafe, apiPost } from "../lib/api";

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
}

export function GameHud() {
  const store = getMapStore();
  const session = useMapStoreSnapshot((s) => s.session);
  const trackingMode = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const cameraMode = useMapStoreSnapshot((s) => s.gameCameraMode);
  const avatarStyle = useMapStoreSnapshot((s) => s.avatarStyle);
  const gotchiToken = useMapStoreSnapshot((s) => s.aavegotchiTokenId);
  const [caught, setCaught] = useState(0);
  const [encounters, setEncounters] = useState(0);
  const [orbs, setOrbs] = useState(() => loadCollectedOrbIds().size);
  const [xp, setXp] = useState(() => loadOrbXp());
  const [quests, setQuests] = useState<GameQuest[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [staking, setStaking] = useState<StakingOverview | null>(null);

  useEffect(() => {
    const onCaught = () => setCaught((c) => c + 1);
    const onEncounter = () => setEncounters((c) => c + 1);
    const onOrbs = (e: Event) => {
      const detail = (e as CustomEvent<{ count: number; xp: number }>).detail;
      setOrbs((n) => n + (detail?.count ?? 0));
      if (typeof detail?.xp === "number") setXp(detail.xp);
    };
    window.addEventListener("mapos:ghost-caught", onCaught);
    window.addEventListener("mapos:encounter-resolved", onEncounter);
    window.addEventListener("mapos:orbs-collected", onOrbs);
    return () => {
      window.removeEventListener("mapos:ghost-caught", onCaught);
      window.removeEventListener("mapos:encounter-resolved", onEncounter);
      window.removeEventListener("mapos:orbs-collected", onOrbs);
    };
  }, []);

  useEffect(() => {
    void apiGetSafe<{ quests?: GameQuest[]; completedQuestIds?: string[] }>("/game/zones", {
      auth: true
    }).then((data) => {
      setQuests((data?.quests ?? []).slice(0, 5));
      setCompleted(new Set(data?.completedQuestIds ?? []));
    });
  }, [session]);

  const claimQuest = async (quest: GameQuest) => {
    try {
      const result = await apiPost<{ rewardPoints: number }>(`/game/quests/${quest.id}/complete`);
      setCompleted((prev) => new Set(prev).add(quest.id));
      setXp((current) => current + result.rewardPoints);
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

  return (
    <div className="game-hud" data-testid="game-hud">
      <div className="game-hud-row">
        <span className="game-hud-count">👻 {caught}</span>
        <span className="game-hud-count">⚔️ {encounters}</span>
        <span className="game-hud-count" data-testid="orb-count">
          🔮 {orbs} · {xp} XP
        </span>
      </div>
      <div className="game-hud-controls">
        <button
          className={`btn small ${trackingMode === "simulation" ? "btn-accent" : ""}`}
          onClick={() => store.setGameTrackingMode("simulation")}
        >
          Šipky
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
          3rd person
        </button>
        <button
          className={`btn small ${cameraMode === "top" ? "btn-accent" : ""}`}
          onClick={() => store.setGameCameraMode("top")}
        >
          Top
        </button>
      </div>
      <div className="game-hud-controls">
        <button
          className={`btn small ${avatarStyle === "cube" ? "btn-accent" : ""}`}
          onClick={() => store.setAvatarStyle("cube")}
        >
          Cube Guy
        </button>
        <button
          className={`btn small ${avatarStyle === "aavegotchi" ? "btn-accent" : ""}`}
          onClick={() => store.setAvatarStyle("aavegotchi", gotchiToken)}
        >
          Gotchi
        </button>
        <input
          className="gotchi-token-input"
          value={gotchiToken}
          onChange={(e) =>
            store.setAvatarStyle("aavegotchi", e.target.value.replace(/\D/g, "").slice(0, 8))
          }
          placeholder="Token ID"
          title="Aavegotchi token ID"
        />
      </div>
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
        <div className="game-hud-stake">
          <div className="meta">
            Stake ${staking.stakedUsd.toFixed(2)} · tier {staking.tier} · yield $
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
        </div>
      )}
      <span className="meta">WASD/šipky pro pohyb · klikni na ducha nebo encounter</span>
    </div>
  );
}
