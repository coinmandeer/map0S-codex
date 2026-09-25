import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/offlineTest";
import {
  actWorld,
  collectEssence,
  snapshotWorld,
  startExplore,
  winSoloFight,
  worldRequest
} from "./fixtures/worldTest";
import type { GameSession, WorldSnapshot } from "@mapos/layer-sdk";

/** Movement, camera, avatar and which games are running are settings, so they sit behind the
 *  panel header's popover instead of on the HUD itself (§4.6). */
async function openGameSettings(page: Page) {
  await page.getByRole("button", { name: "Nastavení hry" }).click();
  await expect(page.getByTestId("game-settings")).toBeVisible();
}

test.describe("Game", () => {
  test("herní panel se otevírá samostatně a HUD zůstává dostupný", async ({ page }) => {
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible();
    await expect(page.getByTestId("game-panel")).toHaveCount(0);
    await page.getByTestId("game-hud-panel").click();
    await expect(page.getByTestId("game-panel")).toBeVisible();
    await page.getByTestId("game-panel").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("game-panel")).toHaveCount(0);
    await expect(page.getByTestId("game-hud")).toBeVisible();
    await page.getByTestId("hamburger-btn").click();
    await expect(page.getByTestId("game-panel")).toBeVisible();
  });

  test("game mode suspends other layers and restores them on exit", async ({ page }) => {
    await page.route("**/layers/commons-photos/features**", (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.goto("/?mode=personal");
    const photosVisible = () =>
      page.evaluate(async () => {
        const { getMapStore } = await import("/src/store/mapStore.ts");
        return Boolean(getMapStore().activeLayers["commons-photos"]?.visible);
      });
    await page.evaluate(async () => {
      const { getMapStore } = await import("/src/store/mapStore.ts");
      getMapStore().activateLayer("commons-photos");
    });
    await expect.poll(photosVisible).toBe(true);
    await page.getByTestId("mode-game").click();
    await expect.poll(photosVisible).toBe(false);
    await page.getByTestId("mode-personal").click();
    await expect.poll(photosVisible).toBe(true);
  });

  test("guest World rewards are idempotent and survive reconnection", async ({ page }) => {
    await page.goto("/");
    const session = await startExplore(page);
    const earned = await collectEssence(page, session.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    const reconnected = await startExplore(page);
    expect((await snapshotWorld(page, reconnected.id)).progress).toEqual(earned.progress);
    const gps = await worldRequest<GameSession>(page, "session", { mode: "gps" });
    const physical = await worldRequest<WorldSnapshot>(page, "snapshot", { sessionId: gps.id });
    expect(physical.progress.xp).toBe(0);
    expect(physical.physicalPosition).toBeNull();
  });

  test("combat loot upgrades once and persists after a reload", async ({ page }) => {
    await page.goto("/");
    const session = await startExplore(page);
    for (let i = 0; i < 3; i++) await winSoloFight(page, session.id);
    const action = { type: "upgrade" as const, targetId: "weapon", actionId: crypto.randomUUID() };
    const upgraded = await actWorld(page, session.id, action);
    expect(upgraded.progress.weaponLevel).toBe(1);
    expect(upgraded.progress.items["Úlomek strážce"]).toBe(0);
    expect((await actWorld(page, session.id, action)).progress).toEqual(upgraded.progress);
    await page.reload({ waitUntil: "domcontentloaded" });
    const reconnected = await startExplore(page);
    expect((await snapshotWorld(page, reconnected.id)).progress).toEqual(upgraded.progress);
  });
});

/**
 * The scene draws into a custom WebGL layer, so nothing it puts on screen has a DOM node and the
 * checks above pass happily while the whole thing is projected with a matrix of NaN — player,
 * quests and dots all drawn to nowhere. These look at the scene itself: is the camera usable, and
 * is there anything in front of it.
 */
test.describe("herní scéna", () => {
  test("rasterový podklad ukáže hráče i autoritativní svět bez povinného GLB", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.route("**/models/cube-guy-character.glb", (route) =>
      route.fulfill({ status: 404, body: "optional model unavailable" })
    );
    await page.addInitScript(() => {
      localStorage.setItem("mapos:basemap", "osm-carto");
      localStorage.setItem("mapos:avatar-style", "aavegotchi");
      localStorage.setItem("mapos:gotchi-token", "0");
    });

    await page.goto("/?mode=game&lng=13.3775&lat=49.7475&z=17");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 8_000 });
    await page.waitForFunction(() => Boolean(window.__maposGame), null, { timeout: 8_000 });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const game = window.__maposGame?.contents;
            return Boolean(
              game?.hasPlayer &&
              JSON.parse(window.render_game_to_text!()).world.snapshot?.entities.length > 0 &&
              window.__maposMap?.getLayer("custom-gl-game")
            );
          }),
        { timeout: 15_000 }
      )
      .toBe(true);

    expect(
      await page.evaluate(() => JSON.parse(window.render_game_to_text!()).world.error)
    ).toBeNull();
    await page.getByTestId("mode-planning").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Boolean(window.__maposMap?.getSource("mapos-game-road-geometry")) ||
            Boolean(window.__maposGame)
        )
      )
      .toBe(false);
    expect(pageErrors).toHaveLength(0);
  });

  test("po odchodu ze hry uvolní 3D scénu i při opakovaném přepínání", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await page.goto("/");

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await page.getByTestId("mode-game").click();
      await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
      await page.waitForFunction(
        () => Boolean(window.__maposGame && window.__maposMap?.getLayer("custom-gl-game")),
        null,
        { timeout: 20_000 }
      );

      await page.getByTestId("mode-planning").click();
      await expect(page.getByTestId("game-hud")).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(() => ({
            layer: Boolean(window.__maposMap?.getLayer("custom-gl-game")),
            scene: Boolean(window.__maposGame),
            textBridge: Boolean(window.render_game_to_text)
          }))
        )
        .toEqual({ layer: false, scene: false, textBridge: false });
    }

    expect(pageErrors).toHaveLength(0);
  });

  test("projects with a usable camera matrix", async ({ page }) => {
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__maposGame), null, { timeout: 20_000 });

    // MapLibre 5 passes custom layers a bundle of camera data where 4 passed the bare matrix.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const scene = window.__maposGame as unknown as {
              camera: { projectionMatrix: { elements: number[] } };
            };
            return [...scene.camera.projectionMatrix.elements].every(Number.isFinite);
          }),
        { timeout: 15_000 }
      )
      .toBe(true);
  });

  test("puts the player and server world into the scene", async ({ page }) => {
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__maposGame), null, { timeout: 20_000 });

    // The layer loads on demand, so it can miss the first broadcast of where the player is; it
    // has to start them somewhere rather than wait for a move that a standing player never makes.
    await expect
      .poll(() => page.evaluate(() => window.__maposGame?.contents.hasPlayer), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => JSON.parse(window.render_game_to_text!()).world.snapshot?.entities.length ?? 0
          ),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
  });

  test("runs two games over one avatar and one render loop", async ({ page }) => {
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.render_game_to_text), null, {
      timeout: 20_000
    });

    await openGameSettings(page);
    await page.getByTestId("game-active-trail-signals").click();
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = JSON.parse(window.render_game_to_text!());
          return {
            activeGames: state.host.activeGames,
            avatars: state.host.avatarOwners,
            loops: state.host.renderLoops,
            trailNamespace: state.modules["trail-signals"]?.namespace
          };
        })
      )
      .toEqual({
        activeGames: ["aavegotchi", "trail-signals"],
        avatars: 1,
        loops: 1,
        trailNamespace: "trail-signals"
      });

    await page.getByTestId("game-selector-trail-signals").click();
    await expect(page.getByTestId("game-hud")).toContainText("Trail Signals");
    await openGameSettings(page);
    await page.getByTestId("game-active-trail-signals").click();
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).host.activeGames))
      .toEqual(["aavegotchi"]);
    expect(await page.evaluate(() => window.__maposGame?.contents.hasPlayer)).toBe(true);
  });

  test("moves through the public world and switches cameras and avatars without duplicates", async ({
    page
  }) => {
    await page.goto("/?mode=game&lng=14.4378&lat=50.0755&z=16");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__maposGame), null, { timeout: 20_000 });

    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(window.render_game_to_text!()).world.snapshot?.entities.length ?? 0
        )
      )
      .toBeGreaterThan(0);
    const before = await page.evaluate(() => JSON.parse(window.render_game_to_text!()).player);
    await page.locator(".maplibregl-canvas").focus();
    await page.keyboard.down("ArrowRight");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).player.lng))
      .toBeGreaterThan(before.lng);
    await page.keyboard.up("ArrowRight");
    const moved = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
    expect(moved.host.avatarOwners).toBe(1);
    expect(moved.host.renderLoops).toBe(1);
    expect(moved.world.session.mode).toBe("explore");
    expect(moved.world.snapshot.physicalPosition).toBeNull();

    // Movement, camera and avatar all live in the header's settings popover, so it stays open
    // for the rest of the test rather than being reopened per control.
    await openGameSettings(page);
    await page.getByTestId("game-camera-top").click();
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getPitch()), { timeout: 10_000 })
      .toBeLessThan(1);
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getZoom()), { timeout: 10_000 })
      .toBeCloseTo(17.2, 1);

    await page.getByTestId("game-camera-follow").click();
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getPitch()), { timeout: 10_000 })
      .toBeCloseTo(52, 0);

    await page.getByTestId("avatar-gotchi").click();
    await expect
      .poll(() => page.evaluate(() => window.__maposGame?.contents.avatarStyle))
      .toBe("aavegotchi");
    await page.getByTestId("avatar-cube").click();
    await page.waitForTimeout(6_000);
    expect(
      await page.evaluate(() => ({
        style: window.__maposGame?.contents.avatarStyle,
        cube: window.__maposGame?.contents.playerVisible,
        gotchi: window.__maposGame?.contents.hasGotchiAvatar
      }))
    ).toEqual({ style: "cube", cube: true, gotchi: false });
  });
});
