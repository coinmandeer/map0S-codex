import { useEffect, useRef, useState } from "react";
import type { ContactView, GeoThread, WorldMessage, WorldPage } from "@mapos/layer-sdk";
import { TROLLBOX_RADII } from "@mapos/layer-sdk";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useWorld, worldCall, worldRuntime } from "./runtime";
import { QuestComposer } from "./WorldHud";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
export async function saveGeoThread(thread: GeoThread) {
  await worldCall("/threads/save", { id: thread.id });
}
export function WorldSocialOverlay() {
  const state = useWorld(),
    [tab, setTab] = useState("Trollbox"),
    [radius, setRadius] = useState("500"),
    [center, setCenter] = useState("me"),
    [threads, setThreads] = useState<GeoThread[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [contacts, setContacts] = useState<ContactView[]>([]),
    [conversation, setConversation] = useState<ContactView | null>(null),
    [error, setError] = useState("");
  const user = useMapStoreSnapshot((s) => s.session),
    view = useMapStoreSnapshot((s) => s.view);
  const at = center === "me" ? (state.snapshot?.position ?? view) : view;
  const loadThreads = async (more = false) => {
    const page = await worldCall<WorldPage<GeoThread>>(
      "/threads/search",
      tab === "Moje zprávy"
        ? { mine: true, ...(more && cursor ? { before: Number(cursor) } : {}) }
        : radius === "viewport"
          ? {
              bbox: state.bbox ?? [view.lng, view.lat, view.lng, view.lat],
              ...(more && cursor ? { before: Number(cursor) } : {})
            }
          : { ...at, radius: Number(radius), ...(more && cursor ? { before: Number(cursor) } : {}) }
    );
    setThreads((old) =>
      more ? [...old, ...page.items.filter((p) => !old.some((o) => o.id === p.id))] : page.items
    );
    setCursor(page.nextCursor);
  };
  const loadContacts = () => worldCall<ContactView[]>("/contacts").then(setContacts);
  const run = (fn: () => Promise<unknown>) => {
    setError("");
    void fn()
      .then(() => loadContacts())
      .catch((e) => setError(e.message));
  };
  const latestThreads = useLatest(loadThreads),
    userId = user?.id;
  useEffect(() => {
    if (!state.socialOpen || !userId) return;
    const load = () =>
      void (tab === "Kontakty" ? loadContacts() : latestThreads.current()).catch((e) =>
        setError(e.message)
      );
    const debounce = setTimeout(load, 250);
    const timer = tab === "Trollbox" || tab === "Moje zprávy" ? setInterval(load, 5000) : undefined;
    return () => {
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [state.socialOpen, userId, tab, radius, center, view.lng, view.lat, latestThreads]);
  useEffect(() => {
    if (!state.socialOpen || tab !== "Kontakty") return;
    if (state.socialRevision % 3 === 0) void loadContacts().catch(() => {});
  }, [state.socialRevision, state.socialOpen, tab]);
  useEffect(() => {
    worldRuntime.patch({
      geoFilter:
        state.socialOpen && tab === "Trollbox" && radius !== "viewport"
          ? { lng: at.lng, lat: at.lat, radius: Number(radius) }
          : null
    });
  }, [state.socialOpen, tab, radius, at.lng, at.lat]);
  useEffect(() => {
    if (state.socialOpen) {
      setTab(state.messagePoint ? "Zanechat zprávu" : state.socialTab);
      setConversation(null);
    }
  }, [state.socialOpen, state.socialTab, state.messagePoint]);
  if (!state.socialOpen) return null;
  if (state.questPoint)
    return (
      <div
        className="world-social world-ui"
        role="dialog"
        aria-label="Nový quest"
        data-testid="world-quest-composer"
      >
        <header>
          <div>
            <span className="world-eyebrow">MAPOS · QUEST</span>
            <h2>{state.questPoint.anchorName ?? "Nový quest"}</h2>
          </div>
          <button
            aria-label="Zavřít quest"
            onClick={() => worldRuntime.patch({ socialOpen: false, questPoint: null })}
          >
            ×
          </button>
        </header>
        <QuestComposer
          at={state.questPoint}
          onDone={() => worldRuntime.patch({ socialOpen: false, questPoint: null })}
        />
      </div>
    );
  if (state.messagePoint) return <PlaceMessageDialog at={state.messagePoint} />;
  return (
    <aside
      className="world-social world-ui"
      role="dialog"
      aria-label="Okolí a zprávy"
      data-testid="world-social"
    >
      <header>
        <div>
          <span className="world-eyebrow">MAPOS · SPOLEČNĚ VENKU</span>
          <h2>Okolí a zprávy</h2>
        </div>
        <button
          aria-label="Zavřít okolí"
          onClick={() =>
            worldRuntime.patch({
              socialOpen: false,
              threadId: null,
              messagePoint: null,
              questPoint: null
            })
          }
        >
          ×
        </button>
      </header>
      <nav className="world-tabs" aria-label="Sociální sekce">
        {["Trollbox", "Kontakty", "Moje zprávy"].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setConversation(null);
              worldRuntime.patch({ threadId: null, messagePoint: null });
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p className="world-error" role="alert">
          {error}
        </p>
      )}
      {state.threadId ? (
        <ThreadDialog id={state.threadId} onBack={() => worldRuntime.patch({ threadId: null })} />
      ) : conversation ? (
        <PrivateChat contact={conversation} onBack={() => setConversation(null)} />
      ) : (
        <>
          {tab === "Trollbox" && (
            <>
              <div className="world-controls">
                <label>
                  Okruh
                  <select
                    aria-label="Okruh trollboxu"
                    value={radius}
                    onChange={(e) => setRadius(e.target.value)}
                  >
                    {TROLLBOX_RADII.map((r) => (
                      <option key={r} value={r}>
                        {r < 1000 ? `${r} m` : `${r / 1000} km`}
                      </option>
                    ))}
                    <option value="viewport">Výřez mapy</option>
                  </select>
                </label>
                <label>
                  Střed
                  <select value={center} onChange={(e) => setCenter(e.target.value)}>
                    <option value="me">Moje poloha</option>
                    <option value="map">Střed mapy</option>
                  </select>
                </label>
                <button onClick={() => void loadThreads().catch((e) => setError(e.message))}>
                  Obnovit
                </button>
              </div>
              <p className="world-note">
                {at.lat.toFixed(4)}, {at.lng.toFixed(4)} · příspěvky jsou veřejné
              </p>
              <ThreadComposer kind="trollbox" at={at} onDone={() => void loadThreads()} />
            </>
          )}
          {(tab === "Trollbox" || tab === "Moje zprávy") && (
            <>
              {tab === "Moje zprávy" && (
                <button
                  className="world-primary world-wide"
                  onClick={() => {
                    setTab("Zanechat zprávu");
                    worldRuntime.patch({ messagePoint: { lng: view.lng, lat: view.lat } });
                  }}
                >
                  + Zanechat zprávu na mapě
                </button>
              )}
              {threads.map((t) => (
                <article className="world-post" key={t.id}>
                  <div>
                    <button
                      className="world-author"
                      title="Přidat do oblíbených"
                      onClick={() =>
                        run(() => worldCall("/contacts/request", { userId: t.author.id }))
                      }
                    >
                      {t.author.displayName}
                    </button>
                    <small>{new Date(t.createdAt).toLocaleString("cs")}</small>
                  </div>
                  <button
                    className="world-post-title"
                    onClick={() => worldRuntime.openThread(t.id)}
                  >
                    {t.kind === "place" ? "⚑ " : ""}
                    {t.title}
                  </button>
                  <p>{t.body}</p>
                  <div>
                    <small>{originLabel(t.origin)}</small>
                    <button onClick={() => worldRuntime.openThread(t.id)}>
                      {t.replies} odpovědí →
                    </button>
                  </div>
                </article>
              ))}
              {!threads.length && (
                <p className="world-empty">Tady zatím nikdo nic nenapsal. Zanech první zprávu.</p>
              )}
              {cursor && (
                <button
                  className="world-wide"
                  onClick={() => void loadThreads(true).catch((e) => setError(e.message))}
                >
                  Starší zprávy
                </button>
              )}
            </>
          )}
          {tab === "Zanechat zprávu" && (
            <>
              <h3>Zpráva zůstane na tomto místě</h3>
              <p className="world-note">
                Veřejně pod tvým MapOS profilem. Současně ji uložíme do Moje místa.
              </p>
              <ThreadComposer
                kind="place"
                at={state.messagePoint ?? at}
                onDone={(t) => {
                  worldRuntime.patch({ threadId: t.id, messagePoint: null });
                  setTab("Moje zprávy");
                }}
              />
            </>
          )}
          {tab === "Kontakty" && (
            <>
              <div className="world-target">
                <label className="world-check">
                  <input
                    type="checkbox"
                    checked={state.visible}
                    onChange={(e) => void worldRuntime.visibility(e.target.checked)}
                  />{" "}
                  Jsem dostupný v okolí
                </label>
                <p>Cizí lidé uvidí přibližného anonymního ducha.</p>
                <button
                  onClick={() => {
                    const title = window.prompt("Název místa pro hodinový check-in");
                    if (title) void worldRuntime.visibility(true, { title, ...view });
                  }}
                >
                  Check-in na místě
                </button>
              </div>
              <h3>Hráči do 1 km</h3>
              {state.presence.map((p) => (
                <div className="world-contact" key={p.presenceId}>
                  <span className="world-avatar">
                    {p.profile?.avatarUrl ? <img alt="" src={p.profile.avatarUrl} /> : "♧"}
                  </span>
                  <span>
                    <strong>{p.label}</strong>
                    <small>
                      {p.checkIn?.title ?? (p.approximate ? "Přibližná poloha" : "Sdílená poloha")}
                    </small>
                  </span>
                  {!p.profile && (
                    <button
                      onClick={() =>
                        run(() =>
                          worldCall("/contacts/request", {
                            sessionId: state.session?.id,
                            presenceId: p.presenceId
                          })
                        )
                      }
                    >
                      Propojit
                    </button>
                  )}
                  <button
                    aria-label={`Blokovat ${p.label}`}
                    onClick={() =>
                      run(() =>
                        worldCall("/contacts/block", {
                          sessionId: state.session?.id,
                          presenceId: p.presenceId
                        })
                      )
                    }
                  >
                    Blokovat
                  </button>
                </div>
              ))}
              {!state.presence.length && (
                <p className="world-note">V okolí zatím nikdo nesdílí dostupnost.</p>
              )}
              <h3>Oblíbení uživatelé a žádosti</h3>
              {contacts
                .slice()
                .sort((a, b) => Number(b.favorite) - Number(a.favorite))
                .map((c) => (
                  <div className="world-contact-card" key={c.id}>
                    <div className="world-contact">
                      <span className="world-avatar">
                        {c.profile.avatarUrl ? <img src={c.profile.avatarUrl} alt="" /> : "♧"}
                      </span>
                      <strong>{c.profile.displayName}</strong>
                      {c.status === "accepted" && c.favorite && (
                        <button onClick={() => setConversation(c)}>
                          Chat {c.unread ? `(${c.unread})` : ""}
                        </button>
                      )}
                    </div>
                    {c.status === "pending" ? (
                      c.incoming ? (
                        <div className="world-action-row">
                          <button
                            className="world-primary"
                            onClick={() =>
                              run(() => worldCall("/contacts/respond", { id: c.id, accept: true }))
                            }
                          >
                            Přijmout
                          </button>
                          <button
                            onClick={() =>
                              run(() => worldCall("/contacts/respond", { id: c.id, accept: false }))
                            }
                          >
                            Odmítnout
                          </button>
                        </div>
                      ) : (
                        <small>Žádost odeslána · profil se odhalí po přijetí</small>
                      )
                    ) : (
                      <div className="world-action-row">
                        <button
                          onClick={() =>
                            run(() =>
                              worldCall("/contacts/favorite", { id: c.id, enabled: !c.favorite })
                            )
                          }
                        >
                          {c.favorite ? "★ Oblíbený" : "☆ Přidat"}
                        </button>
                        <button
                          onClick={() =>
                            run(() =>
                              worldCall("/position-share", {
                                sessionId: state.session?.id,
                                userId: c.profile.id,
                                enabled: true
                              })
                            )
                          }
                        >
                          Poloha na 15 min
                        </button>
                        <button
                          onClick={() =>
                            run(() =>
                              worldCall("/position-share", {
                                sessionId: state.session?.id,
                                userId: c.profile.id,
                                enabled: false
                              })
                            )
                          }
                        >
                          Ukončit sdílení
                        </button>
                        <button
                          onClick={() =>
                            run(() => worldCall("/contacts/block", { userId: c.profile.id }))
                          }
                        >
                          Blokovat
                        </button>
                        <button
                          onClick={() => run(() => worldCall("/contacts/disconnect", { id: c.id }))}
                        >
                          Ukončit propojení
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </>
          )}
        </>
      )}
    </aside>
  );
}
function originLabel(origin: string) {
  return origin === "nearby"
    ? "U místa podle polohy zařízení"
    : origin === "remote"
      ? "Na dálku"
      : "Poloha nepotvrzena";
}
function ThreadComposer({
  kind,
  at,
  onDone
}: {
  kind: "place" | "trollbox";
  at: { lng: number; lat: number };
  onDone: (t: GeoThread) => void;
}) {
  const state = useWorld(),
    user = getMapStore().session,
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [actionId, setActionId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="world-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          const thread = await worldCall<GeoThread>("/threads/create", {
            kind,
            ...at,
            title: title || body.slice(0, 70),
            body,
            sessionId: state.session?.id,
            actionId
          });

          setTitle("");
          setBody("");
          setActionId(crypto.randomUUID());
          onDone(thread);
        })()
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      {kind === "place" && (
        <input
          required
          aria-label="Název zprávy"
          placeholder="Název místa nebo zprávy"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}
      <textarea
        required
        aria-label="Veřejná zpráva"
        placeholder={kind === "place" ? "Co tady chceš ostatním zanechat?" : "Co se děje v okolí?"}
        maxLength={1600}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <small>
        {user?.displayName} · {at.lat.toFixed(4)}, {at.lng.toFixed(4)} · veřejně
      </small>
      {error && <p role="alert">{error}</p>}
      <button className="world-primary" disabled={busy}>
        {busy ? "Odesílám…" : kind === "place" ? "Zanechat zprávu" : "Napsat do trollboxu"}
      </button>
    </form>
  );
}
function ThreadDialog({ id, onBack }: { id: string; onBack: () => void }) {
  const [thread, setThread] = useState<GeoThread | null>(null),
    [messages, setMessages] = useState<WorldMessage[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [quest, setQuest] = useState(false),
    [actionId, setActionId] = useState(() => crypto.randomUUID());
  const load = async (more = false) => {
    const [t, page] = await Promise.all([
      worldCall<GeoThread>("/threads/get", { id }),
      worldCall<WorldPage<WorldMessage>>("/threads/replies", {
        id,
        ...(more && cursor ? { before: Number(cursor) } : {})
      })
    ]);
    setThread(t);
    setMessages((old) => (more ? [...old, ...page.items] : page.items));
    setCursor(page.nextCursor);
  };
  const latestLoad = useLatest(load);
  useEffect(() => {
    void latestLoad.current().catch((e) => setError(e.message));
  }, [id, latestLoad]);
  const run = (fn: () => Promise<unknown>) =>
    void fn()
      .then(() => load())
      .catch((e) => setError(e.message));
  return (
    <div>
      <button onClick={onBack}>← Zpět</button>
      {error && <p role="alert">{error}</p>}
      {thread && (
        <>
          <h3>{thread.title}</h3>
          <p>{thread.body}</p>
          <small>
            {thread.author.displayName} · {originLabel(thread.origin)}
          </small>
          <div className="world-action-row">
            <button onClick={() => run(() => saveGeoThread(thread))}>Uložit místo</button>
            <button onClick={() => setQuest(!quest)}>Vytvořit quest</button>
            <button
              onClick={() => {
                const reason = window.prompt("Důvod nahlášení");
                if (reason) run(() => worldCall("/threads/report", { id, reason }));
              }}
            >
              Nahlásit
            </button>
            {thread.author.id === getMapStore().session?.id && (
              <>
                <button
                  onClick={() =>
                    run(() => worldCall("/threads/edit", { id, closed: !thread.closed }))
                  }
                >
                  {thread.closed ? "Otevřít vlákno" : "Uzavřít vlákno"}
                </button>
                <button
                  onClick={() => {
                    const edited = window.prompt("Upravit úvodní zprávu", thread.body);
                    if (edited) run(() => worldCall("/threads/edit", { id, body: edited }));
                  }}
                >
                  Upravit text
                </button>
                <button
                  onClick={() =>
                    void worldCall("/threads/edit", { id, hidden: true })
                      .then(onBack)
                      .catch((e) => setError(e.message))
                  }
                >
                  Odstranit veřejnou zprávu
                </button>
              </>
            )}
          </div>
          {quest && <QuestComposer at={thread} onDone={() => setQuest(false)} />}
          <h4>Konverzace na místě</h4>
          {messages
            .slice()
            .reverse()
            .map((m) => (
              <div className="world-post" key={m.id}>
                <strong>{m.author.displayName}</strong>
                <p>{m.body}</p>
              </div>
            ))}
          {cursor && <button onClick={() => void load(true)}>Starší odpovědi</button>}
          <form
            className="world-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await worldCall("/threads/reply", { id, body, actionId });
                setBody("");
                setActionId(crypto.randomUUID());
              });
            }}
          >
            <textarea
              aria-label="Odpověď na místě"
              required
              disabled={thread.closed}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <button disabled={thread.closed}>Odpovědět veřejně</button>
          </form>
        </>
      )}
    </div>
  );
}
function PrivateChat({ contact, onBack }: { contact: ContactView; onBack: () => void }) {
  const [messages, setMessages] = useState<WorldMessage[]>([]),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [actionId, setActionId] = useState(() => crypto.randomUUID());
  const loadedOlder = useRef(false);
  const load = async (more = false) => {
    const page = await worldCall<WorldPage<WorldMessage>>("/dm/history", {
      id: contact.id,
      ...(more && cursor ? { before: Number(cursor) } : {})
    });
    setMessages((old) =>
      [...page.items, ...old.filter((m) => !page.items.some((n) => n.id === m.id))].sort(
        (a, b) => b.createdAt - a.createdAt
      )
    );
    if (more) loadedOlder.current = true;
    if (more || !loadedOlder.current) setCursor(page.nextCursor);
    await worldCall("/dm/read", { id: contact.id });
  };
  const latestLoad = useLatest(load);
  useEffect(() => {
    loadedOlder.current = false;
    setMessages([]);
    void latestLoad.current().catch((e) => setError(e.message));
    const timer = setInterval(
      () =>
        void latestLoad.current().catch((e) => {
          setError(e.message);
          setMessages([]);
        }),
      4000
    );
    return () => clearInterval(timer);
  }, [contact.id, latestLoad]);
  return (
    <div data-testid="world-dm">
      <button onClick={onBack}>← Oblíbení uživatelé</button>
      <h3>{contact.profile.displayName}</h3>
      <p className="world-note">Soukromý chat · šifrovaný přenos. Zatím bez koncového šifrování.</p>
      {error && <p role="alert">{error}</p>}
      {cursor && (
        <button onClick={() => void load(true).catch((e) => setError(e.message))}>
          Starší historie
        </button>
      )}
      <div className="world-message-history">
        {messages
          .slice()
          .reverse()
          .map((m) => (
            <div
              className={`world-message ${m.author.id === getMapStore().session?.id ? "is-mine" : ""}`}
              key={m.id}
            >
              <p>{m.body}</p>
              <small>
                {new Date(m.createdAt).toLocaleTimeString("cs", {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </small>
            </div>
          ))}
      </div>
      <form
        className="world-form"
        onSubmit={(e) => {
          e.preventDefault();
          void worldCall("/dm/send", { id: contact.id, body, actionId })
            .then(() => {
              setBody("");
              setActionId(crypto.randomUUID());
              setError("");
              return load();
            })
            .catch((e) => setError(`${e.message} · text zůstal připravený k opakování.`));
        }}
      >
        <textarea
          aria-label="Soukromá zpráva"
          required
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Napiš zprávu…"
        />
        <button className="world-primary">Odeslat soukromě</button>
      </form>
    </div>
  );
}
export function WorldSocialEntry() {
  return (
    <button className="world-social-entry" onClick={() => worldRuntime.openContacts()}>
      ♧ Oblíbení uživatelé · okolí a zprávy
    </button>
  );
}

function PlaceMessageDialog({ at }: { at: { lng: number; lat: number } }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => worldRuntime.patch({ socialOpen: false, messagePoint: null });
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} className="place-message-dialog world-ui" onCancel={close} onClose={close}>
      <header>
        <h2>Zanechat zprávu</h2>
        <button aria-label="Zavřít zprávu" onClick={close}>
          ×
        </button>
      </header>
      <ThreadComposer
        kind="place"
        at={at}
        onDone={(thread) => {
          worldRuntime.patch({ notes: [...worldRuntime.get().notes, thread] });
          getMapStore().showToast("Zpráva je na mapě");
          close();
        }}
      />
    </dialog>
  );
}
