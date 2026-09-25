import WebSocket, { type RawData } from "ws";
import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { config } from "../../config.js";
import { shipFeature, withinLiveBbox } from "./ships.js";
import { AISSTREAM, type LiveTrafficResult } from "./types.js";

/**
 * Ships worldwide from AISstream.
 *
 * The stream is server-side only (their terms forbid browser connections, and the key must stay
 * on the backend), so this module keeps ONE shared connection and does the fan-out itself:
 *
 *  - the client layer asks for its viewport, which registers a short-lived interest here;
 *  - the union of the live interests is sent as the subscription (replaced at most once a
 *    second, as the service requires);
 *  - latest position and identity per MMSI are kept in memory and pruned, never persisted.
 *
 * Compression is negotiated (`perMessageDeflate`) because uncompressed connections are
 * bandwidth-limited. AISstream guarantees neither uptime nor replay, so the collector reconnects
 * with backoff and an empty answer is explained rather than presented as an empty sea.
 */

const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const INTEREST_TTL_MS = 2 * 60_000;
const VESSEL_STALE_MS = 15 * 60_000;
const MAX_VESSELS = 40_000;
const MAX_BOXES = 4;
/** The service drops a subscription update faster than one per second, so a moving viewport
 *  resubscribes on a coarser clock than it queries. */
const RESUBSCRIBE_MIN_MS = 30_000;
const POSITION_TYPES = new Set([
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "LongRangeAisBroadcastMessage"
]);
const STATIC_TYPES = new Set(["ShipStaticData", "StaticDataReport"]);

interface VesselRecord {
  mmsi: number;
  name?: string;
  imo?: number;
  callSign?: string;
  shipType?: number;
  destination?: string;
  lng: number;
  lat: number;
  sog?: number;
  cog?: number;
  heading?: number;
  navStatus?: number;
  at: number;
}

interface Interest {
  bbox: Bbox;
  expiresAt: number;
}

interface Envelope {
  MessageType?: string;
  MetaData?: { MMSI?: number; ShipName?: string; Latitude?: number; Longitude?: number };
  Message?: Record<string, Record<string, unknown>>;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Mutable vessel state shared by the socket loop and the request path. Kept deliberately plain
 *  so the message application can be tested without a socket. */
export class AisVesselStore {
  private vessels = new Map<number, VesselRecord>();

  apply(envelope: Envelope, now = Date.now()): void {
    const mmsi = envelope.MetaData?.MMSI;
    const type = envelope.MessageType;
    if (typeof mmsi !== "number" || !type) return;
    const body = envelope.Message?.[type];
    if (!body) return;

    if (POSITION_TYPES.has(type)) {
      const lng = number(body.Longitude) ?? envelope.MetaData?.Longitude;
      const lat = number(body.Latitude) ?? envelope.MetaData?.Latitude;
      if (lng === undefined || lat === undefined) return;
      if (lng < -180 || lng > 180 || lat < -85 || lat > 85) return;
      const previous = this.vessels.get(mmsi);
      this.vessels.set(mmsi, {
        mmsi,
        // Static data names the ship authoritatively; the position envelope's name is only a
        // hint and must not overwrite a corrected name on every report.
        name: previous?.name ?? text(envelope.MetaData?.ShipName),
        imo: previous?.imo,
        callSign: previous?.callSign,
        shipType: previous?.shipType,
        destination: previous?.destination,
        lng,
        lat,
        sog: number(body.Sog) ?? previous?.sog,
        cog: number(body.Cog) ?? previous?.cog,
        heading: number(body.TrueHeading) ?? number(body.Heading) ?? previous?.heading,
        navStatus: number(body.NavigationalStatus) ?? previous?.navStatus,
        at: now
      });
    } else if (STATIC_TYPES.has(type)) {
      const reportA = (body.ReportA ?? {}) as Record<string, unknown>;
      const reportB = (body.ReportB ?? {}) as Record<string, unknown>;
      const previous = this.vessels.get(mmsi);
      const name =
        text(body.Name) ??
        text(reportA.Name) ??
        text(envelope.MetaData?.ShipName) ??
        previous?.name;
      const record: VesselRecord =
        previous ?? ({ mmsi, lng: Number.NaN, lat: Number.NaN, at: 0 } as VesselRecord);
      this.vessels.set(mmsi, {
        ...record,
        name,
        imo: number(body.ImoNumber) ?? previous?.imo,
        callSign: text(body.CallSign) ?? text(reportB.CallSign) ?? previous?.callSign,
        shipType: number(body.Type) ?? number(reportB.ShipType) ?? previous?.shipType,
        destination: text(body.Destination) ?? previous?.destination
      });
    }
    if (this.vessels.size > MAX_VESSELS) {
      // Oldest first: a cap must not evict the vessels the map is actually drawing.
      const oldest = [...this.vessels.values()].sort((a, b) => a.at - b.at)[0];
      if (oldest) this.vessels.delete(oldest.mmsi);
    }
  }

  prune(now = Date.now()): void {
    for (const [mmsi, vessel] of this.vessels)
      if (!Number.isFinite(vessel.lng) || now - vessel.at > VESSEL_STALE_MS)
        this.vessels.delete(mmsi);
  }

  inBbox(bbox: Bbox, now = Date.now()): GeoFeature[] {
    const features: GeoFeature[] = [];
    for (const vessel of this.vessels.values()) {
      if (!Number.isFinite(vessel.lng) || !Number.isFinite(vessel.lat)) continue;
      if (!withinLiveBbox(bbox, vessel.lng, vessel.lat)) continue;
      features.push(
        shipFeature(
          {
            mmsi: vessel.mmsi,
            name: vessel.name ?? `MMSI ${vessel.mmsi}`,
            lng: vessel.lng,
            lat: vessel.lat,
            speedKt: vessel.sog,
            courseDeg: vessel.cog,
            headingDeg: vessel.heading ?? vessel.cog,
            navStatus: vessel.navStatus,
            shipType: vessel.shipType,
            imo: vessel.imo,
            callSign: vessel.callSign,
            destination: vessel.destination,
            fixAgeSeconds: vessel.at ? Math.max(0, Math.round((now - vessel.at) / 1000)) : undefined
          },
          AISSTREAM
        )
      );
    }
    return features;
  }

  get size(): number {
    return this.vessels.size;
  }
}

/** Merge nearby interests instead of dropping all but the four largest viewports. */
export function subscriptionBoxes(input: Bbox[], limit = MAX_BOXES): Bbox[] {
  const boxes = input.map((b) => [...b] as Bbox);
  const union = (a: Bbox, b: Bbox): Bbox => [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3])
  ];
  const area = (b: Bbox) => (b[2] - b[0]) * (b[3] - b[1]);
  while (boxes.length > limit) {
    let pair = [0, 1],
      cost = Infinity;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const extra = area(union(boxes[i]!, boxes[j]!)) - area(boxes[i]!) - area(boxes[j]!);
        if (extra < cost) {
          cost = extra;
          pair = [i, j];
        }
      }
    boxes[pair[0]!] = union(boxes[pair[0]!]!, boxes[pair[1]!]!);
    boxes.splice(pair[1]!, 1);
  }
  return boxes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

class AisCollector {
  private store = new AisVesselStore();
  private interests = new Map<string, Interest>();
  private socket: WebSocket | null = null;
  private subscribedKey = "";
  private lastSubscribeAt = 0;
  private retryDelayMs = 5_000;
  private connecting = false;
  private maintenance: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  requestArea(bbox: Bbox): void {
    if (!config.layerKeys.aisstream) return;
    this.interests.set(bbox.join(","), { bbox, expiresAt: Date.now() + INTEREST_TTL_MS });
    if (this.interests.size > 128) {
      // Keep memory bounded without losing coverage: compact still-live interests.
      const expiresAt = Date.now() + INTEREST_TTL_MS;
      const boxes = subscriptionBoxes(this.liveInterests());
      this.interests.clear();
      for (const box of boxes) this.interests.set(box.join(","), { bbox: box, expiresAt });
    }
    if (!this.maintenance) {
      this.maintenance = setInterval(() => {
        this.store.prune();
        this.sync();
      }, 5_000);
      this.maintenance.unref();
    }
    this.store.prune();
    this.sync();
  }

  vessels(bbox: Bbox): LiveTrafficResult {
    this.store.prune();
    const all = this.store
      .inBbox(bbox)
      .sort(
        (a, b) =>
          Number(a.properties.seenPosSeconds ?? 0) - Number(b.properties.seenPosSeconds ?? 0)
      );
    const features = all.slice(0, 600);
    const connected = this.socket?.readyState === WebSocket.OPEN;
    const subscribed: Bbox[] = this.subscribedKey ? JSON.parse(this.subscribedKey) : [];
    const covered = subscribed.some(
      (b) => b[0] <= bbox[0] && b[1] <= bbox[1] && b[2] >= bbox[2] && b[3] >= bbox[3]
    );
    const notice = !connected
      ? "Spojení s AISstream se obnovuje; zobrazené lodě jsou poslední známé polohy."
      : !covered
        ? "Čekám na přihlášení této oblasti k AISstream."
        : !features.length
          ? "Čekám na AIS zprávy v této oblasti; prázdný výřez nepotvrzuje nepřítomnost lodí."
          : all.length > 600
            ? "Zobrazeno nejvýše 600 nejnovějších poloh. Přibliž mapu."
            : undefined;
    return {
      features,
      status: notice ? "partial" : "complete",
      ...(notice ? { notice } : {}),
      source: AISSTREAM,
      fetchedAt: new Date().toISOString()
    };
  }

  get status(): { configured: boolean; connected: boolean; vessels: number; interests: number } {
    return {
      configured: Boolean(config.layerKeys.aisstream),
      connected: this.socket?.readyState === WebSocket.OPEN,
      vessels: this.store.size,
      interests: this.interests.size
    };
  }

  private liveInterests(now = Date.now()): Bbox[] {
    for (const [key, interest] of this.interests)
      if (interest.expiresAt <= now) this.interests.delete(key);
    return subscriptionBoxes([...this.interests.values()].map((interest) => interest.bbox));
  }

  private sync(): void {
    const boxes = this.liveInterests();
    if (!boxes.length) {
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      this.connecting = false;
      if (this.maintenance) clearInterval(this.maintenance);
      this.maintenance = null;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.subscribedKey = "";
      return;
    }
    if (!this.socket && !this.connecting && !this.retryTimer) {
      this.connect(boxes);
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (JSON.stringify(boxes) === this.subscribedKey) return;
    // Subscription updates replace the previous configuration, and the service closes a
    // connection that updates faster than once per second.
    if (Date.now() - this.lastSubscribeAt < RESUBSCRIBE_MIN_MS) return;
    this.subscribe(boxes);
  }

  private subscribe(boxes: Bbox[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    // AISstream wants [lat, lon] corners.
    const message = {
      APIKey: config.layerKeys.aisstream,
      BoundingBoxes: boxes.map(([west, south, east, north]) => [
        [south, west],
        [north, east]
      ]),
      FilterMessageTypes: [...POSITION_TYPES, ...STATIC_TYPES]
    };
    this.socket.send(JSON.stringify(message));
    this.subscribedKey = JSON.stringify(boxes);
    this.lastSubscribeAt = Date.now();
  }

  private connect(_boxes: Bbox[]): void {
    this.connecting = true;
    let socket: WebSocket;
    try {
      socket = new WebSocket(STREAM_URL, { perMessageDeflate: true });
    } catch {
      this.connecting = false;
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.connecting = false;
      this.retryDelayMs = 5_000;
      this.subscribedKey = "";
      this.lastSubscribeAt = 0;
      this.sync();
    });
    socket.on("message", (raw: RawData) => {
      if (this.socket !== socket) return;
      try {
        const parsed = JSON.parse(raw.toString()) as Envelope;
        if (parsed.MessageType === "SubscriptionConfirmation") return;
        this.store.apply(parsed);
      } catch {
        // One malformed frame must not kill a long-lived stream.
      }
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connecting = false;
      this.scheduleRetry();
    });
    socket.on("error", () => {
      if (this.socket !== socket) return;
      socket.close();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.liveInterests().length) return;
    const delay = this.retryDelayMs * (0.8 + Math.random() * 0.4);
    this.retryDelayMs = Math.min(60_000, Math.round(this.retryDelayMs * 1.8));
    const timer = setTimeout(() => {
      this.retryTimer = null;
      if (this.liveInterests().length) this.sync();
    }, delay);
    this.retryTimer = timer;
    timer.unref();
  }

  /** Test/ops hatch: drops the socket and all memory of tracked vessels. */
  reset(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.connecting = false;
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.interests.clear();
    this.subscribedKey = "";
    this.store = new AisVesselStore();
  }
}

export const aisCollector = new AisCollector();
