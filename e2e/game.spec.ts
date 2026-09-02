import { test, expect } from "./fixtures/offlineTest";

/** Unlike the smoke test, these run against the real memory server so the deterministic spawner,
 *  the guest auto-login and the quest loop are all exercised end to end. */

/**
 * Three ghosts per z12 cell, scattered inside it and then clipped to the requested box — so a box
 * that only clips the corners of a few cells can legitimately come back empty, and does, on some
 * of the half-hourly respawn buckets. This one swallows whole cells, which makes "is the world
 * populated?" a question about the spawner rather than about what time it is.
 */
const PRAGUE_WHOLE_CELLS = "14.2,49.9,14.7,50.3";

test.describe("Hra", () => {
  test("herní deep link otevře standardní panel, který lze skrýt a znovu zobrazit", async ({
    page
  }) => {
    await page.goto("/?mode=game");

    const gameHud = page.getByTestId("game-hud");
    await expect(gameHud).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("hamburger-btn")).toHaveCount(0);

    await page.getByTestId("game-panel").getByRole("button", { name: "Zavřít" }).click();
    await expect(gameHud).toBeHidden();
    const panelToggle = page.getByTestId("hamburger-btn");
    await expect(panelToggle).toHaveAttribute("aria-expanded", "false");

    await panelToggle.click();
    await expect(gameHud).toBeVisible();
    await expect(page.getByTestId("hamburger-btn")).toHaveCount(0);
  });

  test("guest players get ghosts and quests without ever logging in", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/");
    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });

    const ghosts = await page.evaluate(async (bbox) => {
      const res = await fetch(`http://localhost:4033/game/ghosts?bbox=${bbox}`);
      return ((await res.json()) as { ghosts: unknown[] }).ghosts.length;
    }, PRAGUE_WHOLE_CELLS);
    expect(ghosts).toBeGreaterThan(0);

    await expect(page.getByTestId("orb-count")).toBeVisible();
    expect(pageErrors).toHaveLength(0);
  });

  test("a quest can be claimed once and then reads as done", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("mode-game").click();
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });

    const quest = page.getByTestId("quest-q1");
    await expect(quest).toBeVisible({ timeout: 15_000 });

    if (await quest.isDisabled()) return; // already claimed by an earlier run against the same server

    await quest.click();
    await expect(quest).toContainText("hotovo");
    await expect(quest).toBeDisabled();
  });

  test("catching a ghost removes it from the world for this player", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (box) => {
      const base = "http://localhost:4033";
      const bbox = `bbox=${box}`;
      await fetch(`${base}/auth/guest`, { method: "POST", credentials: "include" });

      const list = async () =>
        (
          (await (
            await fetch(`${base}/game/ghosts?${bbox}`, { credentials: "include" })
          ).json()) as {
            ghosts: { id: string }[];
          }
        ).ghosts;

      const before = await list();
      const target = before[0]!.id;
      const caught = await fetch(`${base}/game/ghosts/${target}/catch`, {
        method: "POST",
        credentials: "include"
      });
      const again = await fetch(`${base}/game/ghosts/${target}/catch`, {
        method: "POST",
        credentials: "include"
      });
      const after = await list();
      return {
        catchStatus: caught.status,
        repeatStatus: again.status,
        stillThere: after.some((g) => g.id === target)
      };
    }, PRAGUE_WHOLE_CELLS);

    expect(result.catchStatus).toBe(200);
    expect(result.repeatStatus).not.toBe(200);
    expect(result.stillThere).toBe(false);
  });
});

/**
 * The scene draws into a custom WebGL layer, so nothing it puts on screen has a DOM node and the
 * checks above pass happily while the whole thing is projected with a matrix of NaN — player,
 * quests and dots all drawn to nowhere. These look at the scene itself: is the camera usable, and
 * is there anything in front of it.
 */
test.describe("herní scéna", () => {
  test("rasterový podklad nezamrzne a hned ukáže Gotchiho i silniční pole", async ({ page }) => {
    const pageErrors: Error[] = [];
    const genericAvatarRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    page.on("request", (request) => {
      if (request.url().includes("/models/cube-guy-character.glb")) {
        genericAvatarRequests.push(request.url());
      }
    });
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
              game?.hasGotchiAvatar &&
              !game.playerVisible &&
              game.orbs > 0 &&
              window.__maposMap?.getSource("mapos-game-road-geometry")
            );
          }),
        { timeout: 15_000 }
      )
      .toBe(true);

    expect(await page.evaluate(() => window.__maposGame?.contents.orbs ?? 0)).toBeGreaterThan(0);
    expect(genericAvatarRequests).toHaveLength(0);
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

  test("puts the player and their dots into the scene", async ({ page }) => {
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__maposGame), null, { timeout: 20_000 });

    // The layer loads on demand, so it can miss the first broadcast of where the player is; it
    // has to start them somewhere rather than wait for a move that a standing player never makes.
    await expect
      .poll(() => page.evaluate(() => window.__maposGame?.contents.hasPlayer), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__maposGame?.contents.orbs ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test("runs two games over one avatar and one render loop", async ({ page }) => {
    await page.goto("/?mode=game");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.render_game_to_text), null, {
      timeout: 20_000
    });

    await page.getByRole("button", { name: "Zapnout Trail Signals" }).click();
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

    await page.getByRole("button", { name: "Trail Signals", exact: true }).click();
    await expect(page.getByTestId("game-hud")).toContainText("Trail Signals");
    await page.getByRole("button", { name: "Vypnout Trail Signals" }).click();
    await expect
      .poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).host.activeGames))
      .toEqual(["aavegotchi"]);
    expect(await page.evaluate(() => window.__maposGame?.contents.hasPlayer)).toBe(true);
  });

  test("frames a kilometre board and switches avatars without leaving both behind", async ({
    page
  }) => {
    await page.goto("/?mode=game&lng=14.4378&lat=50.0755&z=16");
    await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__maposGame), null, { timeout: 20_000 });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            if (!window.render_game_to_text) return 0;
            return (JSON.parse(window.render_game_to_text()) as { counts: { orbs: number } }).counts
              .orbs;
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThanOrEqual(80);

    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
    expect(state.counts.orbs).toBeGreaterThanOrEqual(80);
    expect(
      Math.max(...state.visibleOrbs.map((orb: { distanceM: number }) => orb.distanceM))
    ).toBeGreaterThan(400);
    expect(
      state.visibleOrbs.every((orb: { id: string }) =>
        orb.id.includes(`:${state.orbField.dayKey}:${state.orbField.fieldKey.split(":").at(-1)}:`)
      )
    ).toBe(true);

    const beforeMove = {
      player: state.player,
      fieldKey: state.orbField.fieldKey,
      total: state.orbField.total,
      orbIds: state.visibleOrbs.map((orb: { id: string }) => orb.id)
    };
    await page.keyboard.down("ArrowRight");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const current = JSON.parse(window.render_game_to_text!());
            return current.player.lng;
          }),
        { timeout: 10_000 }
      )
      .toBeGreaterThan(beforeMove.player.lng);
    await page.keyboard.up("ArrowRight");
    const afterMove = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
    expect(afterMove.player.lng).toBeGreaterThan(beforeMove.player.lng);
    expect(afterMove.orbField.fieldKey).toBe(beforeMove.fieldKey);
    expect(afterMove.orbField.total).toBe(beforeMove.total);
    expect(afterMove.visibleOrbs.map((orb: { id: string }) => orb.id)).toEqual(beforeMove.orbIds);
    expect(new Set(afterMove.zones.map((zone: { kind: string }) => zone.kind))).toEqual(
      new Set(["standard", "event", "staker_gate"])
    );

    await page.getByRole("button", { name: "Shora" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getPitch()), { timeout: 10_000 })
      .toBeLessThan(1);
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getZoom()), { timeout: 10_000 })
      .toBeCloseTo(15.8, 1);

    await page.getByRole("button", { name: "Za hráčem" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getPitch()), { timeout: 10_000 })
      .toBeCloseTo(52, 0);

    await page.locator(".game-hud-avatar > summary").click();
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
