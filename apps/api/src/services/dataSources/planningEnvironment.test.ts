import test from "node:test";
import assert from "node:assert/strict";
import { marineFeature, powerFeature } from "./planningEnvironment.js";

test("marine values use the returned grid position, preserve zero and reject stale data", () => {
  const now = Date.now();
  const raw = {
    latitude: 36.625,
    longitude: -4.375,
    current: { time: now / 1000, wave_height: 0, wave_period: null, sea_surface_temperature: 23.1 },
    current_units: { wave_height: "m", wave_period: "s", sea_surface_temperature: "°C" }
  };
  const [feature] = marineFeature(raw, now);
  assert.deepEqual(feature!.geometry.coordinates, [-4.375, 36.625]);
  assert.equal(feature!.properties.waveHeight, 0);
  assert.equal(feature!.properties.wavePeriod, null);
  assert.throws(() => marineFeature(raw, now + 7 * 3600000), /zastaralý/);
  assert.deepEqual(marineFeature({ ...raw, current_units: {} }, now), []);
});
test("solar climatology keeps the provider's reference period and never plots fill values", () => {
  const data = {
    geometry: { type: "Point", coordinates: [-4.42, 36.72, 100] },
    header: { range: "January 2001 - December 2020", fill_value: -999 },
    properties: { parameter: { ALLSKY_SFC_SW_DWN: { ANN: 0 }, T2M: { ANN: -999 } } },
    parameters: { ALLSKY_SFC_SW_DWN: { units: "kW-hr/m^2/day" }, T2M: { units: "C" } }
  };
  const [feature] = powerFeature(data);
  assert.equal(feature!.properties.solarEnergy, 0);
  assert.equal(feature!.properties.temperature, null);
  assert.equal(feature!.properties.period, data.header.range);
  assert.throws(() => powerFeature({ ...data, header: {} }), /období/);
});
