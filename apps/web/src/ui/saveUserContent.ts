import { API_BASE } from "../lib/api";
import { emit } from "../lib/events";

async function ensureDefaultLayer(): Promise<string | null> {
  const list = await fetch(`${API_BASE}/user-layers`, { credentials: "include" });
  if (list.status === 401) return null;
  if (!list.ok) return null;
  const data = (await list.json()) as { layers?: Array<{ id: string }> };
  if (data.layers?.[0]?.id) return data.layers[0].id;
  const created = await fetch(`${API_BASE}/user-layers`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Moje místa", color: "#10b981" })
  });
  if (!created.ok) return null;
  const body = (await created.json()) as { layer?: { id: string } };
  return body.layer?.id ?? null;
}

export async function saveUserPlace(input: {
  name: string;
  lng: number;
  lat: number;
  description?: string;
  kind?: "place" | "route";
  properties?: Record<string, unknown>;
}): Promise<"ok" | "auth" | "error"> {
  try {
    const layerId = await ensureDefaultLayer();
    if (!layerId) return "auth";
    const res = await fetch(`${API_BASE}/user-layers/${layerId}/pins`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        lng: input.lng,
        lat: input.lat,
        description: input.description,
        kind: input.kind ?? "place",
        properties: input.properties
      })
    });
    if (res.status === 401) return "auth";
    if (!res.ok) return "error";
    emit("layers-changed");
    return "ok";
  } catch {
    return "error";
  }
}
