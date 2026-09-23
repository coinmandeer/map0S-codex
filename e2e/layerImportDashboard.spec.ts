import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures/offlineTest";

const manifestFixture = JSON.parse(
  readFileSync(
    new URL("../packages/layer-sdk/src/v2/fixtures/user-layer-manifest.json", import.meta.url),
    "utf8"
  )
) as {
  permissions: Record<string, unknown>;
  [key: string]: unknown;
};

test("owner dashboard previews, publishes and rolls back a canonical layer package", async ({
  page
}) => {
  await page.goto("/?mode=personal");
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/me", { credentials: "include" });
          return Boolean((await response.json()).user);
        }),
      { timeout: 20_000 }
    )
    .toBe(true);

  const mine = page.getByTestId("personal-panel");
  await expect(mine).toBeVisible();
  await mine.getByText("My layers", { exact: true }).click();

  const layerName = `Offline owner import ${Date.now()}`;
  const layerPackage = {
    schema: "mapos.user-layer-package",
    schemaVersion: "2.0.0",
    exportedAt: "2026-09-01T10:00:00.000Z",
    manifest: {
      ...manifestFixture,
      id: "owner.offline-import",
      name: layerName,
      permissions: { ...manifestFixture.permissions, defaultVisibility: "public" },
      attribution: [{ label: "Offline fixture owner", license: "CC0-1.0" }]
    },
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "offline-point-1",
          geometry: { type: "Point", coordinates: [14.42, 50.08] },
          properties: {
            name: "Offline viewpoint",
            description: "No provider request is needed",
            tags: ["offline"],
            kind: "place",
            maposProvenance: [
              {
                source: "owner-fixture",
                sourceRef: "offline-point-1",
                attribution: "Offline fixture owner",
                license: "CC0-1.0",
                capturedAt: "2026-09-01T10:00:00.000Z"
              }
            ]
          }
        }
      ]
    }
  };

  await mine.getByTestId("layer-import-file").setInputFiles({
    name: "owner-fixture.mapos.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(layerPackage))
  });

  const preview = mine.getByTestId("layer-import-preview");
  await expect(preview).toContainText(layerName);
  await expect(preview).toContainText("1 bodů");
  const compatibility = mine.getByTestId("layer-host-compatibility");
  await expect(compatibility).toContainText("Host kompatibilita: Kompatibilní");
  await expect(compatibility).toContainText("mapos.layer-manifest 2.0.0");
  await expect(compatibility).toContainText("SDK 2.0.0 · runtime 19.0.0");

  const privateChoice = preview.getByRole("radio", { name: "Soukromá" });
  const publicChoice = preview.getByRole("radio", { name: "Veřejná" });
  await expect(publicChoice).toBeChecked();
  await privateChoice.check();
  await expect(privateChoice).toBeChecked();
  await publicChoice.check();
  await preview.getByRole("button", { name: "Nainstalovat vrstvu" }).click();

  const report = mine.getByTestId("layer-import-report");
  await expect(report).toContainText("mapos.layer-import-report 2.0.0 · committed");
  await expect(mine.getByTestId("user-layer-row").filter({ hasText: layerName })).toHaveCount(1);

  const stored = await page.evaluate(async (name) => {
    const response = await fetch("/api/user-layers", { credentials: "include" });
    const data = (await response.json()) as {
      layers: Array<{ id: string; name: string; isPublic: number; pinCount: number }>;
    };
    return data.layers.find((layer) => layer.name === name) ?? null;
  }, layerName);
  expect(stored).toMatchObject({ name: layerName, isPublic: 1, pinCount: 1 });

  await report.getByRole("button", { name: "Vrátit import" }).click();
  await expect(report).toContainText("rolled-back");
  await expect(report.getByRole("button", { name: "Vráceno zpět" })).toBeDisabled();
  await expect(mine.getByTestId("user-layer-row").filter({ hasText: layerName })).toHaveCount(0);

  const remains = await page.evaluate(async (name) => {
    const response = await fetch("/api/user-layers", { credentials: "include" });
    const data = (await response.json()) as { layers: Array<{ name: string }> };
    return data.layers.some((layer) => layer.name === name);
  }, layerName);
  expect(remains).toBe(false);

  const advisoryLayerPackage = {
    ...layerPackage,
    manifest: {
      ...layerPackage.manifest,
      id: "owner.missing-rights",
      name: "Missing rights fixture",
      attribution: [{ label: "Attribution without a licence" }]
    },
    data: {
      ...layerPackage.data,
      features: layerPackage.data.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          maposProvenance: [
            {
              source: "owner-fixture",
              sourceRef: "missing-rights",
              attribution: "Attribution without a licence"
            }
          ]
        }
      }))
    }
  };
  await mine.getByTestId("layer-import-file").setInputFiles({
    name: "missing-rights.mapos.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(advisoryLayerPackage))
  });
  const advisoryPreview = mine.getByTestId("layer-import-preview");
  await expect(advisoryPreview).toContainText("advisory");
  await expect(advisoryPreview).not.toContainText("Zveřejnění je zablokované");
  await expect(advisoryPreview.getByText(/licen[cs]e/i).first()).toBeVisible();
  await expect(advisoryPreview.getByRole("radio", { name: "Veřejná" })).toBeEnabled();
  await expect(advisoryPreview.getByRole("radio", { name: "Veřejná" })).toBeChecked();
});
