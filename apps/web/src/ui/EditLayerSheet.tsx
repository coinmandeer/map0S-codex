import { useEffect, useMemo, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";
import { emit, on } from "../lib/events";
import { Sheet } from "./primitives";

interface UserLayer {
  id: string;
  name: string;
  color: string;
  slug: string;
  pinCount: number;
  isPublic: number;
}

interface UserPin {
  id: string;
  layerId: string;
  name: string;
  description?: string | null;
  lng: number;
  lat: number;
  tags?: string[];
  kind?: "place" | "route" | "task";
}

type PinKind = "place" | "route" | "task";

function tagsFromInput(value: string): string[] {
  return value
    .split(/[,\s#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Požadavek se nepodařil");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function EditLayerSheet() {
  const store = getMapStore();
  const view = useMapStoreSnapshot((state) => state.view);
  const [layers, setLayers] = useState<UserLayer[]>([]);
  const [pins, setPins] = useState<UserPin[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() => store.editLayerId);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [newPinName, setNewPinName] = useState("");
  const [newPinDescription, setNewPinDescription] = useState("");
  const [newPinTags, setNewPinTags] = useState("");
  const [newPinKind, setNewPinKind] = useState<PinKind>("place");
  const [pendingCoords, setPendingCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [newLayerName, setNewLayerName] = useState("");
  const [layerName, setLayerName] = useState("");
  const [layerColor, setLayerColor] = useState("#10b981");
  const [layerPublic, setLayerPublic] = useState(false);
  const [editPinName, setEditPinName] = useState("");
  const [editPinDescription, setEditPinDescription] = useState("");
  const [editPinTags, setEditPinTags] = useState("");
  const [editPinKind, setEditPinKind] = useState<PinKind>("place");
  const [busy, setBusy] = useState(false);

  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedLayerId) ?? null,
    [layers, selectedLayerId]
  );
  const selectedPin = useMemo(
    () => pins.find((pin) => pin.id === selectedPinId) ?? null,
    [pins, selectedPinId]
  );

  useEffect(() => {
    void requestJson<{ layers: UserLayer[] }>("/user-layers")
      .then((data) => {
        setLayers(data.layers ?? []);
        setSelectedLayerId((current) => current ?? data.layers?.[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedLayerId) {
      setPins([]);
      return;
    }
    void requestJson<{ pins: UserPin[] }>(`/user-layers/${selectedLayerId}/pins`)
      .then((data) => setPins(data.pins ?? []))
      .catch(() => setPins([]));
  }, [selectedLayerId]);

  // MapCore uses MapStore's layer id when a map tap becomes a new pin. Keep that ownership key in
  // step with this editor's selection, including the first layer created from an empty account.
  useEffect(() => {
    if (store.editLayerId === selectedLayerId) return;
    store.setEditMode(true, selectedLayerId);
  }, [selectedLayerId, store]);

  useEffect(() => {
    if (!selectedLayer) return;
    setLayerName(selectedLayer.name);
    setLayerColor(selectedLayer.color);
    setLayerPublic(selectedLayer.isPublic === 1);
  }, [selectedLayer]);

  useEffect(() => {
    if (!selectedPin) return;
    setEditPinName(selectedPin.name);
    setEditPinDescription(selectedPin.description ?? "");
    setEditPinTags((selectedPin.tags ?? []).join(", "));
    setEditPinKind(selectedPin.kind ?? "place");
  }, [selectedPin]);

  useEffect(
    () =>
      on("edit-tap", (detail) => {
        setPendingCoords(detail);
        store.showToast("Doplň údaje a ulož pin");
      }),
    [store]
  );

  const mapChanged = () => emit("layers-changed");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      store.showToast(error instanceof Error ? error.message : "Změna se nepodařila");
    } finally {
      setBusy(false);
    }
  };

  const createLayer = () =>
    run(async () => {
      if (!newLayerName.trim()) return;
      const data = await requestJson<{ layer: UserLayer }>("/user-layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newLayerName, color: "#10b981" })
      });
      setLayers((previous) => [...previous, data.layer]);
      setSelectedLayerId(data.layer.id);
      setNewLayerName("");
      if (!store.activeLayers["user-layers"]?.visible) store.toggleLayer("user-layers");
      store.showToast("Vrstva vytvořena");
    });

  const saveLayer = () =>
    run(async () => {
      if (!selectedLayerId) return;
      const data = await requestJson<{ layer: UserLayer }>(`/user-layers/${selectedLayerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: layerName, color: layerColor, isPublic: layerPublic })
      });
      setLayers((previous) =>
        previous.map((layer) => (layer.id === data.layer.id ? data.layer : layer))
      );
      mapChanged();
      store.showToast("Vrstva upravena");
    });

  const removeLayer = () =>
    run(async () => {
      if (!selectedLayerId || !window.confirm("Smazat vrstvu i všechny její piny?")) return;
      await requestJson(`/user-layers/${selectedLayerId}`, { method: "DELETE" });
      const remaining = layers.filter((layer) => layer.id !== selectedLayerId);
      setLayers(remaining);
      setSelectedLayerId(remaining[0]?.id ?? null);
      setSelectedPinId(null);
      mapChanged();
      store.showToast("Vrstva smazána");
    });

  const savePin = () =>
    run(async () => {
      if (!selectedLayerId || !pendingCoords || !newPinName.trim()) return;
      const data = await requestJson<{ pin: UserPin }>(`/user-layers/${selectedLayerId}/pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPinName,
          description: newPinDescription,
          lng: pendingCoords.lng,
          lat: pendingCoords.lat,
          tags: tagsFromInput(newPinTags),
          kind: newPinKind
        })
      });
      setPins((previous) => [...previous, data.pin]);
      setLayers((previous) =>
        previous.map((layer) =>
          layer.id === selectedLayerId ? { ...layer, pinCount: layer.pinCount + 1 } : layer
        )
      );
      setNewPinName("");
      setNewPinDescription("");
      setNewPinTags("");
      setPendingCoords(null);
      mapChanged();
      store.showToast("Pin uložen");
    });

  const saveEditedPin = () =>
    run(async () => {
      if (!selectedLayerId || !selectedPinId) return;
      const data = await requestJson<{ pin: UserPin }>(
        `/user-layers/${selectedLayerId}/pins/${selectedPinId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editPinName,
            description: editPinDescription,
            tags: tagsFromInput(editPinTags),
            kind: editPinKind
          })
        }
      );
      setPins((previous) => previous.map((pin) => (pin.id === data.pin.id ? data.pin : pin)));
      mapChanged();
      store.showToast("Pin upraven");
    });

  const removePin = () =>
    run(async () => {
      if (!selectedLayerId || !selectedPinId || !window.confirm("Smazat tento pin?")) return;
      await requestJson(`/user-layers/${selectedLayerId}/pins/${selectedPinId}`, {
        method: "DELETE"
      });
      setPins((previous) => previous.filter((pin) => pin.id !== selectedPinId));
      setLayers((previous) =>
        previous.map((layer) =>
          layer.id === selectedLayerId
            ? { ...layer, pinCount: Math.max(0, layer.pinCount - 1) }
            : layer
        )
      );
      setSelectedPinId(null);
      mapChanged();
      store.showToast("Pin smazán");
    });

  return (
    <Sheet title="Moje vrstvy" onClose={() => store.setEditMode(false)} testId="edit-sheet">
      <p className="meta" style={{ marginBottom: 12 }}>
        Vyber vrstvu. Nový pin můžeš založit ve středu mapy; v bočním zobrazení také klepnutím do
        mapy.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Nová vrstva…"
          value={newLayerName}
          onChange={(event) => setNewLayerName(event.target.value)}
          style={{ flex: 1 }}
          data-testid="new-layer-name"
        />
        <button
          className="btn btn-accent"
          onClick={createLayer}
          disabled={busy}
          data-testid="create-layer-btn"
        >
          +
        </button>
      </div>

      {layers.map((layer) => (
        <button
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? "active" : ""}`}
          onClick={() => {
            setSelectedLayerId(layer.id);
            setSelectedPinId(null);
          }}
          data-testid={`user-layer-${layer.id}`}
        >
          <div className="layer-icon" style={{ background: `${layer.color}33` }}>
            📌
          </div>
          <div className="layer-info">
            <h3>{layer.name}</h3>
            <p>
              {layer.pinCount} pinů · {layer.isPublic ? "veřejná" : "soukromá"}
            </p>
          </div>
        </button>
      ))}

      {selectedLayer && (
        <section style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <h3>Nastavení vrstvy</h3>
          <input value={layerName} onChange={(event) => setLayerName(event.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              value={layerColor}
              onChange={(event) => setLayerColor(event.target.value)}
              aria-label="Barva vrstvy"
            />
            <label className="meta">
              <input
                type="checkbox"
                checked={layerPublic}
                onChange={(event) => setLayerPublic(event.target.checked)}
              />{" "}
              Veřejná přes /l/{selectedLayer.slug}
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-accent" onClick={saveLayer} disabled={busy}>
              Uložit vrstvu
            </button>
            <button className="btn" onClick={removeLayer} disabled={busy}>
              Smazat vrstvu
            </button>
          </div>
        </section>
      )}

      {selectedLayerId && !pendingCoords && (
        <button
          className="btn block"
          type="button"
          data-testid="pin-at-map-center"
          onClick={() => setPendingCoords({ lng: view.lng, lat: view.lat })}
        >
          ＋ Přidat pin ve středu mapy
        </button>
      )}

      {selectedLayerId && pendingCoords && (
        <section style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <h3>Nový pin</h3>
          <span className="meta">
            {pendingCoords.lat.toFixed(5)}, {pendingCoords.lng.toFixed(5)}
          </span>
          <input
            placeholder="Název pinu"
            value={newPinName}
            onChange={(event) => setNewPinName(event.target.value)}
            data-testid="pin-name-input"
          />
          <textarea
            placeholder="Popis"
            value={newPinDescription}
            onChange={(event) => setNewPinDescription(event.target.value)}
          />
          <input
            placeholder="Tagy (#hidden-gem, vanlife…)"
            value={newPinTags}
            onChange={(event) => setNewPinTags(event.target.value)}
          />
          <select
            value={newPinKind}
            onChange={(event) => setNewPinKind(event.target.value as PinKind)}
          >
            <option value="place">Místo</option>
            <option value="route">Trasa</option>
            <option value="task">Úkol</option>
          </select>
          <button
            className="btn btn-accent"
            onClick={savePin}
            disabled={busy}
            data-testid="save-pin-btn"
          >
            Uložit pin
          </button>
        </section>
      )}

      {selectedLayerId && pins.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3>Piny ve vrstvě</h3>
          {pins.map((pin) => (
            <button
              key={pin.id}
              className={`layer-item ${selectedPinId === pin.id ? "active" : ""}`}
              onClick={() => setSelectedPinId(pin.id)}
              data-testid={`user-pin-${pin.id}`}
            >
              <div className="layer-icon">📍</div>
              <div className="layer-info">
                <h3>{pin.name}</h3>
                <p>{pin.kind ?? "place"}</p>
              </div>
            </button>
          ))}
        </section>
      )}

      {selectedPin && (
        <section style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <h3>Upravit pin</h3>
          <input
            value={editPinName}
            onChange={(event) => setEditPinName(event.target.value)}
            data-testid="edit-pin-name"
          />
          <textarea
            value={editPinDescription}
            onChange={(event) => setEditPinDescription(event.target.value)}
          />
          <input value={editPinTags} onChange={(event) => setEditPinTags(event.target.value)} />
          <select
            value={editPinKind}
            onChange={(event) => setEditPinKind(event.target.value as PinKind)}
          >
            <option value="place">Místo</option>
            <option value="route">Trasa</option>
            <option value="task">Úkol</option>
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-accent" onClick={saveEditedPin} disabled={busy}>
              Uložit pin
            </button>
            <button className="btn" onClick={removePin} disabled={busy}>
              Smazat pin
            </button>
          </div>
        </section>
      )}
    </Sheet>
  );
}
