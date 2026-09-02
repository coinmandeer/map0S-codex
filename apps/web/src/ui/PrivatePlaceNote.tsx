import { useEffect, useState } from "react";
import type { Place } from "@mapos/layer-sdk";
import { readPrivatePlaceNote, writePrivatePlaceNote } from "../lib/privatePlaceNote";
import { getMapStore } from "../store/mapStore";

export function PrivatePlaceNote({ place }: { place: Place }) {
  const store = getMapStore();
  const [note, setNote] = useState(() => readPrivatePlaceNote(window.localStorage, place.id));
  const [draft, setDraft] = useState(note?.body ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = readPrivatePlaceNote(window.localStorage, place.id);
    setNote(next);
    setDraft(next?.body ?? "");
    setEditing(false);
    setError(null);
  }, [place.id]);

  const save = () => {
    try {
      const next = writePrivatePlaceNote(window.localStorage, place.id, draft);
      setNote(next);
      setDraft(next?.body ?? "");
      setEditing(false);
      setError(null);
      store.showToast(next ? "Soukromá poznámka je uložená" : "Soukromá poznámka byla smazána");
    } catch {
      setError("Prohlížeč poznámku neumožnil uložit.");
    }
  };

  if (!editing && !note) {
    return (
      <div className="private-place-note empty" data-testid="private-place-note-empty">
        <p className="meta">Poznámka se uloží jen do tohoto prohlížeče a funguje i offline.</p>
        <button className="btn" type="button" onClick={() => setEditing(true)}>
          Přidat soukromou poznámku
        </button>
      </div>
    );
  }

  return (
    <div className="private-place-note" data-testid="private-place-note">
      {editing ? (
        <>
          <textarea
            rows={4}
            maxLength={4_000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Co si chceš o místě pamatovat?"
            aria-label="Soukromá poznámka"
          />
          {error && <p className="inline-error">{error}</p>}
          <div className="actions compact">
            <button className="btn btn-accent" type="button" onClick={save}>
              Uložit
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setDraft(note?.body ?? "");
                setEditing(false);
                setError(null);
              }}
            >
              Zrušit
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{note?.body}</p>
          <p className="meta">
            Uloženo v tomto zařízení · {new Date(note!.updatedAt).toLocaleString("cs-CZ")}
          </p>
          <button className="btn" type="button" onClick={() => setEditing(true)}>
            Upravit
          </button>
        </>
      )}
    </div>
  );
}
