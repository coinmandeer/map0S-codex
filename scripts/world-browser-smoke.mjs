import { chromium } from "playwright";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["geolocation"],
  geolocation: { longitude: 14.425, latitude: 50.085, accuracy: 5 }
});
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
process.on("uncaughtException", async (error) => {
  console.error(error.message);
  try {
    await page.screenshot({ path: "output/world/failure.png" });
    console.log((await page.locator("body").innerText()).slice(-3000));
  } catch {
    /* Optional browser state may be unavailable. */
  }
  await browser.close();
  process.exit(1);
});
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5199/?mode=game", {
  waitUntil: "domcontentloaded",
  timeout: 120000
});
console.log("loaded");
await page.getByTestId("game-tracking").waitFor();
await page.waitForFunction(
  () => window.render_game_to_text && JSON.parse(window.render_game_to_text()).world.testEnabled,
  { timeout: 60000 }
);
await page.getByTestId("game-tracking").selectOption("simulation");
await page.waitForFunction(
  () => {
    const s = window.render_game_to_text && JSON.parse(window.render_game_to_text()).world;
    return s?.snapshot?.positionReady && s?.session?.mode === "test";
  },
  { timeout: 60000 }
);
const initial = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
await page.keyboard.press("ArrowUp");
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(500);
await page.keyboard.up("ArrowRight");
await page.screenshot({ path: "output/world/desktop.png" });
const call = async (p, path, body = {}) =>
  p.evaluate(
    async ({ path, body }) => {
      const r = await fetch("/api/v2/world" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(d));
      return d;
    },
    { path, body }
  );
const session = await call(page, "/session", { mode: "test" });
let snap = await call(page, "/snapshot", { sessionId: session.id });
const essence = snap.entities.find((e) => e.kind === "essence");
await page.evaluate(
  (e) =>
    window.dispatchEvent(
      new CustomEvent("mapos:geolocation", { detail: { lng: e.lng, lat: e.lat } })
    ),
  essence
);
await call(page, "/position", { sessionId: session.id, position: essence, accuracy: 0 });
snap = await call(page, "/action", {
  sessionId: session.id,
  action: { type: "collect", targetId: essence.id, actionId: crypto.randomUUID() }
});
if (snap.progress.xp !== 10) throw new Error("collection XP mismatch");
const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 800 } }),
  other = await ctx2.newPage();
await other.goto("http://localhost:5199/?mode=personal", {
  waitUntil: "domcontentloaded",
  timeout: 120000
});
await other.waitForFunction(() => document.querySelector('[data-testid="personal-panel"]'), {
  timeout: 60000
});
const second = await call(other, "/session", { mode: "test" });
await call(other, "/position", { sessionId: second.id, position: essence, accuracy: 0 });
await call(other, "/presence", { sessionId: second.id, visible: true });
const nearby = await call(page, "/nearby", { sessionId: session.id });
if (!nearby.length || nearby[0].profile) throw new Error("anonymous presence");
const request = await call(page, "/contacts/request", {
  sessionId: session.id,
  presenceId: nearby[0].presenceId
});
await call(other, "/contacts/respond", { id: request.id, accept: true });
await call(page, "/dm/send", {
  id: request.id,
  body: "Ahoj, sejdeme se u portálu.",
  actionId: crypto.randomUUID()
});
const history = await call(other, "/dm/history", { id: request.id });
if (history.items.length !== 1) throw new Error("private history");
await page.getByRole("button", { name: "Okolí", exact: true }).click();
await page.getByRole("button", { name: "Otevřít trollbox a kontakty ↗" }).click();
await page.getByRole("button", { name: "Kontakty", exact: true }).click();
await page.getByRole("button", { name: /^Chat/ }).first().click();
await page.screenshot({ path: "output/world/private-chat.png" });
console.log("private chat verified");
await page.getByRole("button", { name: "Zavřít okolí" }).click();
await page.getByRole("button", { name: "Svět", exact: true }).click();
snap = await call(page, "/snapshot", { sessionId: session.id });
const boss = snap.entities.find((e) => e.kind === "boss");
await page.evaluate(
  (e) =>
    window.dispatchEvent(
      new CustomEvent("mapos:geolocation", { detail: { lng: e.lng, lat: e.lat } })
    ),
  boss
);
for (const [p, s] of [
  [page, session],
  [other, second]
]) {
  await call(p, "/position", { sessionId: s.id, position: boss, accuracy: 0 });
  await call(p, "/action", {
    sessionId: s.id,
    action: { type: "engage", targetId: boss.id, actionId: crypto.randomUUID() }
  });
}
await page.evaluate(
  async (id) => (await import("/src/world/runtime.ts")).worldRuntime.select(id),
  boss.id
);
await page.waitForTimeout(1200);
await page.screenshot({ path: "output/world/raid.png" });
for (let i = 0; i < 26; i++) {
  for (const [p, s] of [
    [page, session],
    [other, second]
  ]) {
    snap = await call(p, "/snapshot", { sessionId: s.id });
    if (!snap.entities.some((e) => e.id === boss.id && e.hp > 0)) break;
    await call(p, "/action", {
      sessionId: s.id,
      action: {
        type: snap.castReadyAt <= Date.now() ? "cast" : "shoot",
        targetId: boss.id,
        actionId: crypto.randomUUID()
      }
    });
  }
  if (!snap.entities.some((e) => e.id === boss.id && e.hp > 0)) break;
  await page.waitForTimeout(550);
}
const raidA = await call(page, "/snapshot", { sessionId: session.id }),
  raidB = await call(other, "/snapshot", { sessionId: second.id });
if (raidA.progress.xp !== 160 || raidB.progress.xp !== 150) throw new Error("raid reward mismatch");
console.log("cooperative raid verified");
await page.getByRole("button", { name: "Okolí", exact: true }).click();
await page.getByRole("button", { name: "Zanechat zprávu ve středu mapy ↗" }).click();
await page.getByLabel("Název zprávy").fill("Portál u kašny");
await page
  .getByLabel("Veřejná zpráva")
  .fill("Tady jsme porazili prvního strážce. Přidej se příště!");
await page.getByRole("button", { name: "Zanechat zprávu", exact: true }).click();
await page.getByRole("heading", { name: "Konverzace na místě" }).waitFor();
await page.screenshot({ path: "output/world/place-thread.png" });
console.log("place note verified");
const threads = await call(page, "/threads/search", { mine: true });
const thread = threads.items.find((t) => t.title === "Portál u kašny");
if (!thread) throw new Error("missing note");
const saved = await page.evaluate(() => fetch("/api/v2/me/saved-places").then((r) => r.json()));
if (!JSON.stringify(saved).includes("social-thread:" + thread.id)) throw new Error("not in Moje");
await page.getByRole("button", { name: "Zavřít okolí" }).click();
await page.goto("http://localhost:5199/?mode=personal", { waitUntil: "domcontentloaded" });
await page.getByTestId("personal-panel").waitFor();
await page.getByTestId("personal-section-places").click();
await page.getByText("Portál u kašny", { exact: true }).first().click();
await page.getByRole("heading", { name: "Konverzace na místě" }).waitFor();
await page.screenshot({ path: "output/world/reopened-note.png" });
console.log("saved note reopened after page reload");
await page.getByRole("button", { name: "Zavřít okolí" }).click();
await page.goto("http://localhost:5199/?mode=game", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__maposGame);
await page.getByTestId("game-tracking").selectOption("simulation");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).world.snapshot?.positionReady
);
// Render three verified live GLBs independently from ownership/login validation.
for (const hash of [
  "28fb3a83445fef83e5f036a57df612c6ba6c0d7155c72874ce53d511e57d6bfb",
  "a8540ad348d459bb53df850efc61039f3ba3a13c36eb34e120abfb09205c8fa7",
  "0a4bc6e1eb04267ab864ee9c6e36da51aa62251966fc4f6efb97ce1ff3969ea4"
]) {
  await page.evaluate(async (hash) => {
    await window.__maposGame.setLiveAvatar("/api/v2/world/models/" + hash + ".glb");
  }, hash);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "output/world/model-" + hash.slice(0, 6) + ".png" });
}
console.log("three 3D appearances rendered");
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "output/world/mobile.png" });
await fs.writeFile(
  "output/world/browser-result.json",
  JSON.stringify(
    {
      errors,
      initial,
      final: await page.evaluate(() => JSON.parse(window.render_game_to_text())),
      threads,
      raidA,
      raidB,
      saved
    },
    null,
    2
  )
);
console.log(JSON.stringify({ ok: true, errors }));
await browser.close();
if (errors.length) process.exitCode = 1;
