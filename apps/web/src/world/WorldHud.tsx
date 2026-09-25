import { useIsMobile } from "../ui/useIsMobile";
import { emit, on } from "../lib/events";
import { useEffect, useState } from "react";
import type { GameQuest, GotchiModel, WorldEntity, WorldPosition } from "@mapos/layer-sdk";
import { PanelShell } from "../ui/PanelShell";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";
import { injectedWalletConnector, listWalletIdentities } from "../lib/wallet";
import { useWorld, worldCall, worldRuntime } from "./runtime";

export function metres(a: WorldPosition | null | undefined, b: WorldPosition) {
  if (!a) return "—";
  const m = Math.hypot(
    (a.lng - b.lng) * 111320 * Math.cos((b.lat * Math.PI) / 180),
    (a.lat - b.lat) * 111320
  );
  return m > 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
const icons: Record<string, string> = {
  essence: "◆",
  chest: "▣",
  lickquidator: "♟",
  boss: "♜",
  portal: "◎",
  coin: "●"
};
export function WorldHud() {
  const state = useWorld(),
    store = getMapStore();
  const mode = useMapStoreSnapshot((s) => s.mode),
    open = useMapStoreSnapshot((s) => s.sidebarOpen),
    tracking = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const [practice, setPractice] = useState<{ collected: number; quests: GameQuest[] }>({
    collected: 0,
    quests: []
  });
  useEffect(() => on("game-practice", setPractice), []);
  const [tab, setTab] = useState("Svět"),
    [creating, setCreating] = useState(false);
  const snapshot = state.snapshot,
    target = snapshot?.entities.find((e) => e.id === state.targetId);
  useEffect(() => {
    if (state.snapshot?.arena?.entityId) setTab("Svět");
  }, [state.snapshot?.arena?.entityId]);
  useEffect(() => {
    if (state.targetId && snapshot?.quests.some((q) => q.id === state.targetId)) setTab("Questy");
  }, [state.targetId, snapshot?.quests]);
  if (mode !== "game" || !open) return null;
  return (
    <PanelShell
      title="Aavegotchi · Hry"
      testId="game-panel"
      className="world-panel"
      headerExtra={
        <span className={`world-connection ${state.connected ? "is-online" : ""}`}>
          {tracking === "simulation" && !state.connected
            ? "Volný průzkum"
            : state.connected
              ? "Živě"
              : "Připojuji"}
        </span>
      }
    >
      <div className="world-ui" data-testid="game-panel-hud">
        <div className="world-hero">
          <div className="world-gotchi-icon" aria-hidden>
            <svg viewBox="0 0 32 36" width="44" height="50">
              <path
                d="M8 3h16v4h4v22h-4v4h-6v-4h-4v4H8v-4H4V7h4z"
                fill="#fff"
                stroke="#9361df"
                strokeWidth="2"
              />
              <path d="M9 12h5v7H9zm9 0h5v7h-5z" fill="#8750da" />
              <path d="M13 23h6" stroke="#8750da" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <span className="world-eyebrow">REAL WORLD · GOTCHI WORLD</span>
            <h2>
              {state.session?.avatarTokenId
                ? `Gotchi #${state.session.avatarTokenId}`
                : "Tvůj příběh začíná venku"}
            </h2>
            <p>
              {state.session?.avatarTokenId
                ? "Vlastní Aavegotchi na Base"
                : "Připoj svého gotchi nebo vyraz jako průzkumník."}
            </p>
          </div>
        </div>
        <div className="world-vitals">
          <div>
            <strong data-testid="game-rank">Lvl {snapshot?.progress.level ?? 1}</strong>
            <span>{snapshot?.progress.xp ?? 0} XP</span>
          </div>
          <progress
            aria-label="Postup úrovně"
            max={100}
            value={(snapshot?.progress.xp ?? 0) % 100}
          />
          <div>
            <span>♥ {snapshot?.hp ?? 100} / 100</span>
            <span>
              {!snapshot
                ? "VOLNÝ PRŮZKUM"
                : state.session?.mode !== "gps"
                  ? "PRŮZKUM · BEZ GPS ODMĚN"
                  : "MAPOS XP"}
            </span>
          </div>
        </div>
        <div className="world-controls">
          <label>
            Pohyb
            <select
              aria-label="Pohyb hráče"
              data-testid="game-tracking"
              value={tracking}
              onChange={(e) => store.setGameTrackingMode(e.target.value as "gps" | "simulation")}
            >
              <option value="gps">GPS · skutečná chůze</option>
              <option value="simulation">Prozkoumat · šipky / WASD</option>
            </select>
          </label>
          <button
            onClick={() =>
              store.setGameCameraMode(store.gameCameraMode === "follow" ? "top" : "follow")
            }
          >
            Pohled {store.gameCameraMode === "follow" ? "shora" : "za hráčem"}
          </button>
        </div>
        <button
          className="world-wide"
          onClick={() => {
            emit("game-recenter");
          }}
        >
          ◎ Zpět k hráči
        </button>
        {tracking === "simulation" && (
          <p className="world-note">
            Šipky / WASD · Shift pro sprint · {practice.collected} bodů v průzkumu. Ověřený postup
            vyžaduje GPS.
          </p>
        )}
        {tracking === "gps" && !snapshot?.positionReady && (
          <p className="world-note">
            {state.locationStatus}
            <button onClick={() => void worldRuntime.retryLocation()}>Obnovit polohu</button>
          </p>
        )}
        {state.error && (
          <div role="alert" className="world-error">
            {state.error}
            <button aria-label="Zavřít hlášení" onClick={() => worldRuntime.patch({ error: null })}>
              ×
            </button>
          </div>
        )}
        <nav className="world-tabs" aria-label="Herní sekce">
          {["Svět", "Questy", "Inventář", "Okolí"].map((t) => (
            <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {tab === "Svět" && (
          <>
            <div className="world-section-heading">
              <h3>Dobrodružství kolem tebe</h3>
              <span>{snapshot?.entities.length ?? practice.quests.length} míst</span>
            </div>
            {!snapshot &&
              practice.quests.map((q) => (
                <button
                  className="world-entity"
                  key={q.id}
                  onClick={() => emit("fly-to", { lng: q.lng, lat: q.lat, zoom: 18.3 })}
                >
                  <span>◎</span>
                  <span>
                    <strong>{q.title}</strong>
                    <small>
                      {q.completed ? "Navštíveno v průzkumu" : "Průzkumný bod · dojdi k místu"}
                    </small>
                  </span>
                </button>
              ))}
            {target && (
              <div className="world-target">
                <span className="world-eyebrow">
                  VYBRANÝ CÍL · {metres(snapshot?.position, target)}
                </span>
                <h3>{target.name}</h3>
                {target.maxHp > 0 && (
                  <>
                    <progress aria-label="Zdraví nepřítele" max={target.maxHp} value={target.hp} />
                    <small>
                      {target.hp} / {target.maxHp} HP · fáze {target.phase}
                      {target.kind === "boss" ? ` · ${target.participants}/8 hráčů` : ""}
                    </small>
                  </>
                )}
                <EntityActions entity={target} />
              </div>
            )}
            <div className="world-entity-list">
              {snapshot?.entities.map((e) => (
                <button
                  className={`world-entity ${state.targetId === e.id ? "is-selected" : ""}`}
                  key={e.id}
                  onClick={() => worldRuntime.select(e.id)}
                >
                  <span className={`world-entity-icon kind-${e.kind}`}>{icons[e.kind]}</span>
                  <span>
                    <strong>{e.name}</strong>
                    <small>
                      {e.kind === "boss"
                        ? "Společný raid · 2–8 hráčů"
                        : e.kind === "essence"
                          ? "+10 XP · herní esence"
                          : e.kind === "coin"
                            ? "+5 XP · mince na ulici"
                            : e.kind === "lickquidator"
                              ? "Setkání · +25 XP"
                              : "Objev místo"}
                    </small>
                  </span>
                  <span>{metres(snapshot.position, e)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "Questy" && (
          <>
            <div className="world-section-heading">
              <h3>Questy a keše</h3>
              {snapshot && <button onClick={() => setCreating(!creating)}>+ Vytvořit</button>}
            </div>
            {creating && <QuestComposer onDone={() => setCreating(false)} />}
            {!snapshot &&
              practice.quests.map((q) => (
                <article className="world-target" key={q.id}>
                  <h3>{q.title}</h3>
                  <p>{q.description}</p>
                  <small>
                    {q.completed ? "Navštíveno v průzkumu" : "Dojdi k místu na mapě"} · bez
                    ověřených XP
                  </small>
                  <button onClick={() => emit("fly-to", { lng: q.lng, lat: q.lat, zoom: 18.3 })}>
                    Ukázat na mapě
                  </button>
                </article>
              ))}
            {snapshot?.quests.map((q) => (
              <QuestCard key={q.id} quest={q} />
            ))}
            {!snapshot?.quests.length && !practice.quests.length && (
              <div className="world-empty">
                Zanech první keš nebo úkol ve svém okolí.
                <br />
                Návštěva · tajná odpověď · trasa
              </div>
            )}
          </>
        )}
        {tab === "Inventář" && (
          <>
            <GotchiInventory />
            <h3>Nasbíráno na cestách</h3>
            {snapshot && (
              <div className="world-target">
                <h3>Zbraň · úroveň {snapshot.progress.weaponLevel ?? 0}/5</h3>
                <p>
                  Každá úroveň přidá +2 k útoku a +4 k Fireballu. Postup se ukládá pro tento režim.
                </p>
                <button
                  data-testid="game-upgrade"
                  disabled={
                    (snapshot.progress.weaponLevel ?? 0) >= 5 ||
                    (snapshot.progress.items["Úlomek strážce"] ?? 0) <
                      3 * ((snapshot.progress.weaponLevel ?? 0) + 1)
                  }
                  onClick={() => void worldRuntime.action("upgrade", "weapon")}
                >
                  Vylepšit za {3 * ((snapshot.progress.weaponLevel ?? 0) + 1)} úlomků strážce
                </button>
              </div>
            )}
            <div className="world-inventory">
              {Object.entries(snapshot?.progress.items ?? {}).map(([name, count]) => (
                <div key={name}>
                  <span>◆</span>
                  <strong>{name}</strong>
                  <b>×{count}</b>
                </div>
              ))}
            </div>
            {!Object.keys(snapshot?.progress.items ?? {}).length && (
              <p className="world-note">První esence čeká venku.</p>
            )}
            {snapshot?.progress.badges.map((b) => (
              <p className="world-badge" key={b}>
                ✦ {b}
              </p>
            ))}
          </>
        )}
        {tab === "Okolí" && (
          <>
            <div className="world-target">
              <span className="world-eyebrow">SPOLEČNĚ NAD MAPOU</span>
              <h3>{state.presence.length} hráčů v okolí</h3>
              <p>Cizí lidé vidí pouze přibližného anonymního ducha.</p>
              <button
                className="world-primary"
                onClick={() => void worldRuntime.visibility(!state.visible)}
              >
                {state.visible ? "Skrýt mou přítomnost" : "Být dostupný v okolí"}
              </button>
            </div>
            <button className="world-wide" onClick={() => worldRuntime.openSocial()}>
              Otevřít trollbox a kontakty ↗
            </button>
            <button className="world-wide" onClick={() => worldRuntime.openSocial(store.view)}>
              Zanechat zprávu ve středu mapy ↗
            </button>
          </>
        )}
      </div>
    </PanelShell>
  );
}
function EntityActions({ entity }: { entity: WorldEntity }) {
  return (
    <div className="world-action-row">
      {["essence", "chest"].includes(entity.kind) ? (
        <button
          className="world-primary"
          onClick={() => void worldRuntime.action("collect", entity.id)}
        >
          {entity.kind === "chest" ? "Otevřít truhlu" : "Sebrat esenci"}
        </button>
      ) : entity.kind !== "portal" ? (
        <>
          <button onClick={() => void worldRuntime.action("engage", entity.id)}>
            Vstoupit do souboje
          </button>
          <button
            className="world-primary"
            onClick={() => void worldRuntime.action("shoot", entity.id)}
          >
            Střílet
          </button>
          <button onClick={() => void worldRuntime.action("cast", entity.id)}>✦ Kouzlo</button>
        </>
      ) : (
        <button onClick={() => worldRuntime.openSocial()}>Najít spoluhráče</button>
      )}
    </div>
  );
}
export function WorldActionBar() {
  const state = useWorld(),
    mode = useMapStoreSnapshot((s) => s.mode);
  const mobile = useIsMobile(),
    panelOpen = useMapStoreSnapshot((s) => s.sidebarOpen);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  const target = state.snapshot?.entities.find((e) => e.id === state.targetId);
  if (mode !== "game" || !target || state.socialOpen || (mobile && panelOpen)) return null;
  return (
    <div className="world-actionbar">
      <strong>{target.name}</strong>
      {["essence", "chest", "coin"].includes(target.kind) ? (
        <button onClick={() => void worldRuntime.action("collect")}>
          {target.kind === "coin" ? "Sebrat minci" : "Sebrat"}
        </button>
      ) : target.kind === "portal" ? (
        <button onClick={() => worldRuntime.openSocial()}>Najít spoluhráče</button>
      ) : state.snapshot?.arena?.entityId !== target.id || state.snapshot?.hp === 0 ? (
        <button onClick={() => void worldRuntime.action("engage")}>
          {state.snapshot?.hp === 0 ? "Znovu vstoupit · 100 HP" : "Vstoupit do souboje"}
        </button>
      ) : (
        <>
          <button
            disabled={(state.snapshot?.shootReadyAt ?? 0) > now}
            onClick={() => void worldRuntime.action("shoot")}
          >
            ◈ Střelba
          </button>
          <button
            disabled={(state.snapshot?.castReadyAt ?? 0) > now}
            onClick={() => void worldRuntime.action("cast")}
          >
            ✦{" "}
            {(state.snapshot?.castReadyAt ?? 0) > now
              ? `${Math.ceil((state.snapshot!.castReadyAt - now) / 1000)} s`
              : "Kouzlo"}
          </button>
        </>
      )}
    </div>
  );
}
function GotchiInventory() {
  const state = useWorld();
  const [items, setItems] = useState<{ tokenId: string; name: string | null }[]>([]),
    [notice, setNotice] = useState("Vyber Aavegotchi ze své peněženky."),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const identities = await listWalletIdentities();
      const wallet = identities.find((i) => !i.simulated);
      if (!wallet) {
        setNotice("Připoj peněženku s vlastním Aavegotchi.");
        return;
      }
      const response = await fetch(
        `${API_BASE}/v2/me/aavegotchi-inventory?identityId=${encodeURIComponent(wallet.id)}`,
        { credentials: "include" }
      );
      const data = await response.json();
      const inventory = data.inventory ?? data;
      setItems(inventory.items ?? []);
      setNotice(inventory.notice ?? data.message ?? "Inventář načten");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const select = async (tokenId: string) => {
    if (!state.session) return;
    setBusy(true);
    try {
      await worldCall("/avatar", { sessionId: state.session.id, tokenId });
      worldRuntime.patch({
        session: { ...state.session, avatarTokenId: tokenId },
        model: await worldCall<GotchiModel>("/models/request", { sessionId: state.session.id })
      });
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="world-target">
      <span className="world-eyebrow">TVŮJ AAVEGOTCHI · BASE</span>
      <h3>Jedna postava, tvůj svět</h3>
      <p>{state.model?.notice ?? notice}</p>
      <div className="world-action-row">
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void injectedWalletConnector
              .connect()
              .then(load)
              .catch((e) => setNotice(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Připojit peněženku
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void load();
            if (state.session?.avatarTokenId)
              void worldCall<GotchiModel>("/models/request", {
                sessionId: state.session.id,
                retry: true
              }).then((model) => worldRuntime.patch({ model }));
          }}
        >
          Obnovit
        </button>
      </div>
      {items.map((item) => (
        <button
          className="world-wide"
          key={item.tokenId}
          disabled={busy}
          onClick={() => void select(item.tokenId)}
        >
          {item.name ?? "Aavegotchi"} #{item.tokenId} →
        </button>
      ))}
    </section>
  );
}
function QuestCard({ quest }: { quest: GameQuest }) {
  const [answer, setAnswer] = useState("");
  const state = useWorld();
  const target = quest.kind === "trail" ? (quest.checkpoints[quest.checkpoint] ?? quest) : quest;
  return (
    <div className="world-target" data-testid={`quest-${quest.id}`}>
      <span className="world-eyebrow">
        {quest.kind} · +{quest.xp} XP
      </span>
      <h3>{quest.title}</h3>
      <p>{quest.description}</p>
      <button
        onClick={() => {
          worldRuntime.select(quest.id);
          emit("fly-to", { ...target, zoom: 17 });
        }}
      >
        ◎ Ukázat na mapě · {metres(state.snapshot?.position, target)}
      </button>
      {quest.sourceUrl && (
        <a href={quest.sourceUrl} target="_blank" rel="noreferrer">
          {quest.sourceLabel ?? "Zdroj místa"} ↗
        </a>
      )}
      {quest.hint && (
        <details>
          <summary>Nápověda</summary>
          {quest.hint}
        </details>
      )}
      {quest.kind === "cache" && (
        <input
          aria-label="Odpověď ke keši"
          placeholder="Tajná odpověď"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      )}
      {quest.kind === "trail" && (
        <p>
          Checkpoint {quest.checkpoint + 1} / {quest.checkpoints.length}
        </p>
      )}
      <button
        disabled={quest.completed || !state.snapshot?.positionReady}
        onClick={() => {
          if (quest.kind === "raid" || quest.kind === "combat") {
            worldRuntime.select(quest.id);
            void worldRuntime.action("engage", quest.id);
          } else void worldRuntime.action("quest", quest.id, answer);
        }}
      >
        {quest.completed
          ? "✓ Splněno"
          : quest.kind === "combat"
            ? "Vstoupit do souboje"
            : quest.kind === "raid"
              ? "Vstoupit do raidu"
              : "Potvrdit na místě"}
      </button>
    </div>
  );
}
export function QuestComposer({ onDone, at }: { onDone: () => void; at?: WorldPosition }) {
  const state = useWorld(),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [kind, setKind] = useState("visit"),
    [answer, setAnswer] = useState(""),
    [hint, setHint] = useState(""),
    [actionId] = useState(() => crypto.randomUUID()),
    [startsAt, setStartsAt] = useState(""),
    [endsAt, setEndsAt] = useState(""),
    [points, setPoints] = useState<WorldPosition[]>([]),
    [error, setError] = useState("");
  return (
    <form
      className="world-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!state.session) return;
        void worldCall("/quests", {
          sessionId: state.session.id,
          ...(at ?? getMapStore().view),
          title,
          description: body,
          kind,
          answer,
          hint,
          checkpoints: points,
          actionId,
          ...(startsAt ? { startsAt: new Date(startsAt).getTime() } : {}),
          ...(endsAt ? { endsAt: new Date(endsAt).getTime() } : {})
        })
          .then(onDone)
          .catch((e) => setError(e.message));
      }}
    >
      <label>
        Druh
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="visit">Návštěva · 50 XP</option>
          <option value="cache">Keš · 100 XP</option>
          <option value="trail">Trasa · 100 XP</option>
        </select>
      </label>
      <input
        required
        maxLength={100}
        placeholder="Název questu"
        aria-label="Název questu"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        required
        maxLength={1600}
        placeholder="Co má hráč udělat?"
        aria-label="Zadání questu"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {kind === "cache" && (
        <>
          <input
            required
            placeholder="Neveřejná odpověď"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <input placeholder="Nápověda" value={hint} onChange={(e) => setHint(e.target.value)} />
        </>
      )}
      {kind === "trail" && (
        <>
          <button
            type="button"
            disabled={points.length >= 8}
            onClick={() =>
              setPoints([...points, { lng: getMapStore().view.lng, lat: getMapStore().view.lat }])
            }
          >
            Přidat střed mapy jako checkpoint ({points.length}/8)
          </button>
          <small>Posuň mapu k dalšímu bodu a přidej jej.</small>
        </>
      )}
      <div className="world-controls">
        <label>
          Začátek
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label>
          Konec
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
      </div>
      <small>Umístění: {at ? "zvolené místo" : "střed mapy"} · bez zadaného času platí 7 dnů</small>
      {error && <p role="alert">{error}</p>}
      <button className="world-primary">Vytvořit quest</button>
    </form>
  );
}
