import { useEffect, useState } from "react";
import type { GeoFeature } from "@mapos/layer-sdk";
import { safeExternalUrl } from "../info/detailModel";
import { PanelShell } from "./PanelShell";
import { Button } from "./kit";
import { st } from "../statistics/labels";

export function liveTrafficFields(properties: GeoFeature["properties"]) {
  const fields: Array<[string, string, string]> = [
    ["callsign", "Volací znak", ""],
    ["callSign", "Volací znak", ""],
    ["registration", "Registrace", ""],
    ["aircraftType", "Typ letadla", ""],
    ["mmsi", "MMSI", ""],
    ["imo", "IMO", ""],
    ["shipType", "Typ lodi", ""],
    ["altitudeFt", "Výška", "ft"],
    ["speedKt", "Rychlost", "kn"],
    ["courseDeg", "Kurz pohybu", "°"],
    ["headingDeg", "Orientace", "°"],
    ["verticalRateFpm", "Vertikální rychlost", "ft/min"],
    ["navStatus", "Navigační stav", ""],
    ["destination", "Cíl", ""],
    ["squawk", "Squawk", ""],
    ["emergency", "Nouzový stav", ""]
  ];
  return fields.flatMap(([id, label, unit]) => {
    const value = properties[id];
    return value == null || value === ""
      ? []
      : [{ id, label, value: `${value}${unit ? ` ${unit}` : ""}` }];
  });
}

/** Vehicles are observations, so opening them must not trigger place enrichment or travel offers. */
export function LiveTrafficDetail({ feature }: { feature: GeoFeature }) {
  const p = feature.properties;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const observedAt = typeof p.observedAt === "string" ? Date.parse(p.observedAt) : NaN;
  const age = Number.isFinite(observedAt)
    ? Math.max(0, Math.round((now - observedAt) / 1000))
    : Number(p.fixAgeSeconds ?? p.seenPosSeconds ?? 0);
  const url = safeExternalUrl(p.externalUrl);
  const fields = liveTrafficFields(p);
  return (
    <PanelShell title={String(p.name ?? "Doprava")} testId="live-traffic-detail" dismissible>
      <h2>{String(p.name ?? "Doprava")}</h2>
      <p>
        {String(p.sourceLabel ?? "")} · {st("Stáří polohy", "Position age")}: {age} s
      </p>
      <p>
        {p.positionMode === "estimated"
          ? st(
              "Poloha na mapě je dopočítaná z poslední zprávy.",
              "Map position is estimated from the last report."
            )
          : st("Poslední naměřená poloha.", "Last observed position.")}
      </p>
      {(p.stale || age > (p.layerId === "live-vessels" ? 900 : 90)) && (
        <p role="status">
          {st(
            "Zastaralá poloha — objekt už může být jinde.",
            "Stale position — the vehicle may have moved."
          )}
        </p>
      )}
      <dl>
        {fields.map((field) => (
          <div key={field.id}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {url && (
        <Button icon="open_in_new" onClick={() => window.open(url, "_blank", "noreferrer")}>
          {st("Otevřít detail poskytovatele", "Open provider details")}
        </Button>
      )}
      <p>
        {st(
          "Pokrytí závisí na přijímačích. Údaje nejsou určené pro navigaci.",
          "Coverage depends on receivers. Data is not intended for navigation."
        )}
      </p>
    </PanelShell>
  );
}
