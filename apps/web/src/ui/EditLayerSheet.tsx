import { useEffect, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { API_BASE } from "../lib/api";

interface UserLayer {
  id: string;
  name: string;
  color: string;
  slug: string;
  pinCount: number;
}

export function EditLayerSheet() {
  const store = getMapStore();
  const [layers, setLayers] = useState<UserLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [newPinName, setNewPinName] = useState("");
  const [newPinTags, setNewPinTags] = useState("");
  const [newPinKind, setNewPinKind] = useState<"place" | "route" | "task">("place");
  const [pendingCoords, setPendingCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [newLayerName, setNewLayerName] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/user-layers`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setLayers(data.layers ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ lng: number; lat: number }>).detail;
      setPendingCoords(detail);
      store.showToast("Klikni pro uložení pinu");
    };
    window.addEventListener("mapos:edit-tap", handler);
    return () => window.removeEventListener("mapos:edit-tap", handler);
  }, [store]);

  const createLayer = async () => {
    if (!newLayerName.trim()) return;
    const res = await fetch(`${API_BASE}/user-layers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newLayerName, color: "#10b981" })
    });
    const data = await res.json();
    setLayers((prev) => [...prev, data.layer]);
    setSelectedLayerId(data.layer.id);
    setNewLayerName("");
    store.toggleLayer("user-layers");
    store.showToast("Vrstva vytvořena");
  };

  const savePin = async () => {
    if (!selectedLayerId || !pendingCoords || !newPinName.trim()) return;
    await fetch(`${API_BASE}/user-layers/${selectedLayerId}/pins`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newPinName,
        lng: pendingCoords.lng,
        lat: pendingCoords.lat,
        tags: newPinTags
          .split(/[,\s#]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        kind: newPinKind
      })
    });
    setNewPinName("");
    setNewPinTags("");
    setPendingCoords(null);
    store.showToast("Pin uložen");
    window.dispatchEvent(new Event("mapos:layers-changed"));
  };

  return (
    <>
      <div className="sheet-overlay" onClick={() => store.setEditMode(false)} />
      <div className="sheet" data-testid="edit-sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>Edit mód</h2>
          <button className="btn" onClick={() => store.setEditMode(false)}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p style={{ color: "var(--text-muted)", marginBottom: 12, fontSize: 13 }}>
            Klepni na mapu pro přidání pinu
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Nová vrstva…"
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-accent" onClick={createLayer} data-testid="create-layer-btn">
              +
            </button>
          </div>

          {layers.map((l) => (
            <button
              key={l.id}
              className={`layer-item ${selectedLayerId === l.id ? "active" : ""}`}
              onClick={() => setSelectedLayerId(l.id)}
            >
              <div className="layer-icon" style={{ background: l.color + "33" }}>
                📌
              </div>
              <div className="layer-info">
                <h3>{l.name}</h3>
                <p>
                  {l.pinCount} pinů · /l/{l.slug}
                </p>
              </div>
            </button>
          ))}

          {selectedLayerId && pendingCoords && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                placeholder="Nazev pinu"
                value={newPinName}
                onChange={(e) => setNewPinName(e.target.value)}
                data-testid="pin-name-input"
              />
              <input
                placeholder="Tagy (#hidden-gem, vanlife…)"
                value={newPinTags}
                onChange={(e) => setNewPinTags(e.target.value)}
              />
              <select
                value={newPinKind}
                onChange={(e) => setNewPinKind(e.target.value as "place" | "route" | "task")}
              >
                <option value="place">Misto</option>
                <option value="route">Trasa</option>
                <option value="task">Ukol</option>
              </select>
              <button className="btn btn-accent" onClick={savePin} data-testid="save-pin-btn">
                Uložit pin
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
