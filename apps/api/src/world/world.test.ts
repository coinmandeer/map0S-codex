import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { SocialWorld } from "./socialWorld.js";
import { MemoryWorldRepository } from "./repository.js";
import type { GameAction } from "@mapos/layer-sdk";
function setup(testEnabled = true) {
  let time = 1788580000000;
  const repository = new MemoryWorldRepository();
  const options = {
    testEnabled,
    now: () => time,
    profile: async (id: string) => ({ id, displayName: `Profile ${id}` }),
    initialXp: async () => 75,
    verifyToken: async (_user: string, id: string) => {
      if (id !== "100") throw new Error("not owner");
    }
  };
  const world = new SocialWorld(repository, options);
  return {
    world,
    repository,
    options,
    advance: (ms: number) => {
      time += ms;
    },
    session: (id: string, mode: "gps" | "test" | "explore" = "test") => {
      const s = world.start(id, mode);
      world.position(id, s.id, { lng: 14.425, lat: 50.085 }, 5);
      return s;
    }
  };
}
const action = (
  type: GameAction["type"],
  targetId: string,
  actionId = randomUUID()
): GameAction => ({ type, targetId, actionId });
test("authoritative rewards reject range, survive concurrent tabs/reconnect and preserve legacy GPS XP", async () => {
  const { world, session, repository } = setup();
  const s = session("alice");
  const e = (await world.snapshot("alice", s.id)).entities.find((e) => e.kind === "essence")!;
  await assert.rejects(world.action("alice", s.id, action("collect", e.id)), /Přibliž/);
  world.position("alice", s.id, e, 0);
  const a = action("collect", e.id);
  await Promise.all([
    world.action("alice", s.id, a),
    world.action("alice", s.id, a),
    world.action("alice", s.id, action("collect", e.id))
  ]);
  assert.equal((await world.snapshot("alice", s.id)).progress.xp, 10);
  assert.equal((await repository.list("rewards")).length, 1);
  const same = world.start("alice", "test");
  assert.equal(same.id, s.id);
  assert.equal((await world.snapshot("alice", same.id)).progress.xp, 10);
  await assert.rejects(world.action("alice", s.id, { ...a, type: "cast" }), /Identifikátor/);
  const gps = session("alice", "gps");
  assert.equal((await world.snapshot("alice", gps.id)).progress.xp, 75);
  await assert.rejects(world.selectAvatar("alice", s.id, "999"), /not owner/);
  await world.selectAvatar("alice", s.id, "100");
  assert.equal(world.player("alice", s.id).session.avatarTokenId, "100");
});
test("production disables test sessions and stale/inaccurate fixes disable rewards and expire raw GPS", async () => {
  const prod = setup(false);
  assert.throws(() => prod.world.start("a", "test"), /vypnutý/);
  const { world, session, advance } = setup();
  const s = session("a", "gps");
  world.position("a", s.id, { lng: 14.425, lat: 50.085 }, 80);
  assert.equal((await world.snapshot("a", s.id)).positionReady, false);
  advance(120001);
  assert.equal(world.player("a", s.id).position, null);
});
test("two players share boss HP, once-only raid rewards and completed boss stays defeated after restart", async () => {
  const { world, repository, options, session, advance } = setup();
  const a = session("a"),
    b = session("b");
  const boss = (await world.snapshot("a", a.id)).entities.find((e) => e.kind === "boss")!;
  for (const [u, s] of [
    ["a", a],
    ["b", b]
  ] as const)
    world.position(u, s.id, boss, 0);
  await world.action("a", a.id, action("engage", boss.id));
  await assert.rejects(world.action("a", a.id, action("shoot", boss.id)), /dva hráče/);
  await world.action("b", b.id, action("engage", boss.id));
  const first = action("shoot", boss.id);
  await world.action("a", a.id, first);
  advance(600);
  await world.action("a", a.id, first);
  assert.equal((await world.snapshot("b", b.id)).entities.find((e) => e.id === boss.id)?.hp, 588);
  for (let i = 0; i < 60; i++) {
    advance(600);
    world.position("a", a.id, boss, 0);
    world.position("b", b.id, boss, 0);
    const u = i % 2 ? "a" : "b",
      s = i % 2 ? a : b;
    const snap = await world.action(u, s.id, action("shoot", boss.id));
    if (!snap.entities.some((e) => e.id === boss.id)) break;
  }
  assert.equal((await world.snapshot("a", a.id)).progress.xp, 150);
  assert.equal((await world.snapshot("b", b.id)).progress.xp, 150);
  assert.equal((await repository.list("rewards")).length, 2);
  const restart = new SocialWorld(repository, options);
  const r = restart.start("c", "test");
  restart.position("c", r.id, boss, 0);
  assert.ok(!(await restart.snapshot("c", r.id)).entities.some((e) => e.id === boss.id));
  await assert.rejects(restart.action("c", r.id, action("engage", boss.id)), /skončil/);
});
test("anonymous presence and pending request carry no recipient identity; approval does not disclose raw position", async () => {
  const { world, session, advance } = setup();
  const a = session("reader-user"),
    b = session("secret-owner-user");
  await world.selectAvatar("secret-owner-user", b.id, "100");
  assert.deepEqual(await world.nearby("reader-user", a.id), []);
  await world.setPresence("secret-owner-user", b.id, { visible: true });
  const [unknown] = await world.nearby("reader-user", a.id);
  assert.ok(unknown);
  const wire = JSON.stringify(unknown);
  for (const secret of ["secret-owner-user", "avatarTokenId", "wallet"])
    assert.ok(!wire.includes(secret), secret);
  assert.notEqual(unknown!.lng, 14.425);
  assert.notEqual(unknown!.lat, 50.085);
  assert.deepEqual(unknown, (await world.nearby("reader-user", a.id))[0]);
  const request = await world.requestContact("reader-user", {
    presenceId: unknown!.presenceId,
    sessionId: a.id
  });
  assert.ok(!JSON.stringify(request).includes("secret-owner-user"));
  assert.ok(!JSON.stringify(await world.contacts("reader-user")).includes("secret-owner-user"));
  await world.respond("secret-owner-user", request.id, true);
  let known = (await world.nearby("reader-user", a.id))[0]!;
  assert.equal(known.profile?.id, "secret-owner-user");
  assert.equal(known.approximate, true);
  assert.notEqual(known.lat, 50.085);
  await world.sharePosition("secret-owner-user", b.id, "reader-user", true);
  known = (await world.nearby("reader-user", a.id))[0]!;
  assert.equal(known.lat, 50.085);
  advance(15 * 60000 + 1);
  world.position("reader-user", a.id, { lng: 14.425, lat: 50.085 }, 5);
  world.position("secret-owner-user", b.id, { lng: 14.425, lat: 50.085 }, 5);
  await world.setPresence("secret-owner-user", b.id, { visible: true });
  assert.equal((await world.nearby("reader-user", a.id))[0]?.approximate, true);
  await world.block("reader-user", "secret-owner-user");
  assert.deepEqual(await world.nearby("reader-user", a.id), []);
  await assert.rejects(
    world.sendPrivate("reader-user", request.id, "blocked", randomUUID()),
    /dostupná/
  );
});
test("private history requires accepted participation on every request, deduplicates sends, survives favorite removal", async () => {
  const { world } = setup();
  const c = await world.requestContact("a", { userId: "b" });
  await assert.rejects(world.privateMessages("a", c.id), /dostupná/);
  await world.respond("b", c.id, true);
  const id = randomUUID();
  await Promise.all([
    world.sendPrivate("a", c.id, "hello", id),
    world.sendPrivate("a", c.id, "hello", id)
  ]);
  assert.equal((await world.privateMessages("b", c.id)).items.length, 1);
  await assert.rejects(world.privateMessages("intruder", c.id), /dostupná/);
  await world.favorite("a", c.id, false);
  assert.equal((await world.privateMessages("a", c.id)).items.length, 1);
  await world.disconnect("b", c.id);
  await assert.rejects(world.privateMessages("a", c.id), /dostupná/);
});
test("geographic radii and viewport query the same persistent threads with reliable pagination and origin", async () => {
  const { world, session } = setup();
  const s = session("a", "gps");
  const at = { lng: 14.425, lat: 50.085 };
  for (const metres of [0, 200, 700, 5000, 15000, 30000])
    await world.createThread("a", {
      ...at,
      lat: at.lat + metres / 111320,
      kind: "place",
      title: `${metres}`,
      body: "Persistent",
      actionId: randomUUID(),
      sessionId: s.id
    });
  for (const [r, count] of [
    [100, 1],
    [500, 2],
    [1000, 3],
    [10000, 4],
    [20000, 5],
    [50000, 6]
  ])
    assert.equal((await world.threads("a", { ...at, radius: r })).items.length, count);
  const rows = (await world.threads("b", { ...at, radius: 50000 })).items;
  assert.equal(rows.find((t) => t.title === "0")?.origin, "nearby");
  assert.equal(rows.find((t) => t.title === "30000")?.origin, "remote");
  const id = rows[0]!.id;
  assert.equal((await world.thread(id)).body, "Persistent");
  await world.reply("b", id, "reply", randomUUID());
  assert.equal((await world.thread(id)).replies, 1);
  await world.editThread("a", id, { closed: true });
  await assert.rejects(world.reply("b", id, "reply", randomUUID()), /uzavřené/);
  for (let i = 0; i < 55; i++)
    await world.createThread("a", {
      ...at,
      kind: "trollbox",
      title: "page",
      body: "pagination",
      actionId: randomUUID()
    });
  const page = await world.threads("a", { ...at, radius: 100 });
  assert.equal(page.items.length, 50);
  const next = await world.threads("a", { ...at, radius: 100, before: page.nextCursor });
  assert.equal(next.items.length, 6);
  assert.ok(!next.items.some((n) => page.items.some((p) => p.id === n.id)));
});
test("cache answers are private and multi-checkpoint retries cannot skip a step", async () => {
  const { world, session } = setup();
  const s = session("a"),
    at = { lng: 14.425, lat: 50.085 };
  const cache = await world.createQuest("a", s.id, {
    ...at,
    title: "Cache",
    description: "Find",
    kind: "cache",
    answer: "Secret answer"
  });
  assert.ok(!JSON.stringify(await world.snapshot("a", s.id)).includes("Secret answer"));
  await assert.rejects(
    world.action("a", s.id, { ...action("quest", cache.id), type: "quest", answer: "wrong" }),
    /nesouhlasí/
  );
  await world.action("a", s.id, {
    ...action("quest", cache.id),
    type: "quest",
    answer: "secret answer"
  });
  assert.equal((await world.snapshot("a", s.id)).progress.xp, 100);
  const trail = await world.createQuest("a", s.id, {
    ...at,
    title: "Trail",
    description: "Walk",
    kind: "trail",
    checkpoints: [at, { ...at, lat: at.lat + 0.001 }]
  });
  const step = action("quest", trail.id);
  await world.action("a", s.id, step);
  await world.action("a", s.id, step);
  assert.equal(
    (await world.snapshot("a", s.id)).quests.find((q) => q.id === trail.id)?.checkpoint,
    1
  );
  await assert.rejects(world.action("a", s.id, action("quest", trail.id)), /cíle/);
});
test("failed transactions restore progress and memory writes cannot be lost beside transactions", async () => {
  const { repository } = setup();
  await assert.rejects(
    repository.transaction(async (tx) => {
      await tx.put("profiles", { id: "rollback" });
      throw new Error("fail");
    })
  );
  assert.equal(await repository.get("profiles", "rollback"), null);
  await Promise.all([
    repository.transaction(async (tx) => {
      await tx.put("profiles", { id: "first" });
      await new Promise((r) => setTimeout(r, 5));
    }),
    repository.put("profiles", { id: "second" })
  ]);
  assert.equal((await repository.list("profiles")).length, 2);
});

test("quest creation retries are idempotent and arena positions do not replace physical eligibility", async () => {
  const { world, session } = setup();
  const s = session("a");
  const at = { lng: 14.425, lat: 50.085 },
    input = {
      ...at,
      kind: "visit",
      title: "A visit",
      description: "Walk here",
      actionId: randomUUID()
    };
  const first = await world.createQuest("a", s.id, input),
    again = await world.createQuest("a", s.id, input);
  assert.equal(first.id, again.id);
  await assert.rejects(world.createQuest("a", s.id, { ...input, title: "different" }), /použit/);
  const boss = (await world.snapshot("a", s.id)).entities.find((e) => e.kind === "boss")!;
  world.position("a", s.id, boss, 0);
  await world.action("a", s.id, action("engage", boss.id));
  const snapshot = await world.snapshot("a", s.id);
  assert.equal(snapshot.physicalPosition, null);
  assert.ok(snapshot.arena);
  assert.notDeepEqual(snapshot.gamePosition, snapshot.position);
  assert.ok(!JSON.stringify(snapshot.arena).includes('"a"'));
});
test("account export and erasure include the world and revoke live access", async () => {
  const { world, session, repository } = setup();
  const s = session("a");
  const contact = await world.requestContact("a", { userId: "b" });
  await world.respond("b", contact.id, true);
  await world.sendPrivate("a", contact.id, "private", randomUUID());
  const note = await world.createThread("a", {
    lng: 14.4,
    lat: 50,
    kind: "place",
    title: "note",
    body: "message",
    actionId: randomUUID()
  });
  const exported = await world.exportUser("a");
  assert.ok(JSON.stringify(exported).includes("private"));
  await world.eraseUser("a");
  assert.throws(() => world.player("a", s.id));
  await assert.rejects(world.thread(note.id));
  await assert.rejects(world.privateMessages("b", contact.id));
  assert.equal((await repository.list("messages")).length, 0);
});

test("area spell damages only joined nearby encounters and honors its shared cooldown", async () => {
  const { world, session } = setup();
  const s = session("a");
  const enemies = (await world.snapshot("a", s.id)).entities
    .filter((e) => e.kind === "lickquidator")
    .slice(0, 2);
  assert.equal(enemies.length, 2);
  for (const e of enemies) {
    world.position("a", s.id, e, 0);
    await world.action("a", s.id, action("engage", e.id));
  }
  // Arrange adjacent encounters; production sectors remain generated by the authority.
  const fights = (world as unknown as { fights: Map<string, { entity: (typeof enemies)[number] }> })
    .fights;
  const first = fights.get(enemies[0]!.id)!.entity;
  const second = fights.get(enemies[1]!.id)!.entity;
  second.lng = first.lng;
  second.lat = first.lat + 0.00002;
  world.position("a", s.id, first, 0);
  const hp = [first.hp, second.hp];
  await world.action("a", s.id, action("cast", first.id));
  assert.equal(first.hp, hp[0]! - 35);
  assert.equal(second.hp, hp[1]! - 35);
  await assert.rejects(world.action("a", s.id, action("cast", second.id)), /obnovuje/);
});

test("a nearby anonymous player can be blocked without returning their account identity", async () => {
  const { world, session } = setup();
  const a = session("a"),
    b = session("b");
  world.setPresence("a", a.id, { visible: true });
  world.setPresence("b", b.id, { visible: true });
  const peer = (await world.nearby("a", a.id))[0]!;
  assert.equal(peer.profile, undefined);
  assert.deepEqual(await world.blockPresence("a", a.id, peer.presenceId), { ok: true });
  assert.deepEqual(await world.nearby("a", a.id), []);
  assert.deepEqual(await world.nearby("b", b.id), []);
  await assert.rejects(world.requestContact("b", { userId: "a" }), /dostupné/);
});

test("public explore works without test permission and cannot grant GPS rewards or presence", async () => {
  const { world, session } = setup(false);
  const practice = session("visitor", "explore");
  const gps = session("visitor", "gps");
  const item = (await world.snapshot("visitor", practice.id)).entities.find(
    (e) => e.kind === "essence"
  )!;
  assert.ok(item.id.startsWith("explore:"));
  world.position("visitor", practice.id, item, 0);
  const request = action("collect", item.id);
  await world.action("visitor", practice.id, request);
  await world.action("visitor", practice.id, request);
  assert.equal((await world.snapshot("visitor", practice.id)).progress.xp, 10);
  assert.equal((await world.snapshot("visitor", gps.id)).progress.xp, 75);
  assert.ok(
    (await world.snapshot("visitor", gps.id)).entities.every((e) => !e.id.startsWith("explore:"))
  );
  await assert.rejects(world.setPresence("visitor", practice.id, { visible: true }), /GPS/);
  await assert.rejects(
    world.setPresence("visitor", practice.id, {
      visible: false,
      checkIn: { ...item, title: "Here" }
    }),
    /GPS/
  );
  assert.throws(() => world.start("visitor", "test"), /vypnutý/);
});

test("coins are shared: one pickup hides the coin from everyone for the respawn window", async () => {
  const { world, session, advance } = setup();
  const a = session("a"),
    b = session("b");
  const coin = (await world.snapshot("a", a.id)).entities.find((e) => e.kind === "coin");
  assert.ok(coin, "a zone coin spawns near the player");
  world.position("a", a.id, coin!, 0);
  world.position("b", b.id, coin!, 0);
  await world.action("a", a.id, action("collect", coin!.id));
  const after = await world.snapshot("a", a.id);
  assert.equal(after.progress.coins, 1);
  assert.equal(after.progress.xp, 5);
  assert.ok(!after.entities.some((e) => e.id === coin!.id), "collected coin disappears");
  assert.ok(
    !(await world.snapshot("b", b.id)).entities.some((e) => e.id === coin!.id),
    "the coin is gone for every player"
  );
  advance(10 * 60_000 + 1);
  // The position itself expires after two minutes; a fresh fix is what a player would have.
  world.position("a", a.id, coin!, 0);
  assert.ok(
    (await world.snapshot("a", a.id)).entities.some((e) => e.id === coin!.id),
    "the coin respawns after the window"
  );
});

test("zones carry a countdown and a guardian near the player", async () => {
  const { world, session } = setup();
  const s = session("z");
  const snapshot = await world.snapshot("z", s.id);
  assert.ok(snapshot.zones.length > 0, "zones are derived around the player");
  for (const zone of snapshot.zones) {
    assert.ok(["active", "scheduled"].includes(zone.lifecycle));
    if (zone.lifecycle === "active") assert.ok((zone.endsInSeconds ?? 0) > 0);
    if (zone.lifecycle === "scheduled") assert.ok((zone.startsInSeconds ?? 0) > 0);
  }
  const guard = snapshot.entities.find((e) => e.id.includes(":guard"));
  assert.ok(guard, "zone guardians spawn");
  assert.ok(["lickquidator", "boss"].includes(guard!.kind));
});

test("solo quest loop grants loot, upgrades once, survives reload and isolates virtual rewards", async () => {
  const { world, repository, options, session, advance } = setup();
  const s = session("rpg", "explore");
  for (let encounter = 0; encounter < 3; encounter++) {
    const snapshot = await world.snapshot("rpg", s.id);
    const quest = snapshot.quests.find((q) => q.kind === "combat")!;
    assert.ok(quest, "a solo combat quest is offered");
    world.position("rpg", s.id, quest, 0);
    await world.action("rpg", s.id, action("engage", quest.id));
    for (let hit = 0; hit < 5; hit++) {
      advance(501);
      await world.action("rpg", s.id, action("shoot", quest.id));
    }
  }
  const before = await world.snapshot("rpg", s.id);
  assert.equal(before.progress.items["Úlomek strážce"], 3);
  const upgrade = action("upgrade", "weapon");
  await Promise.all([world.action("rpg", s.id, upgrade), world.action("rpg", s.id, upgrade)]);
  assert.equal((await world.snapshot("rpg", s.id)).progress.weaponLevel, 1);
  assert.equal((await world.snapshot("rpg", s.id)).progress.items["Úlomek strážce"], 0);
  await assert.rejects(world.action("rpg", s.id, action("upgrade", "weapon")), /Potřebuješ/);
  const restored = new SocialWorld(repository, options);
  const reconnect = restored.start("rpg", "explore");
  assert.equal((await restored.snapshot("rpg", reconnect.id)).progress.weaponLevel, 1);
  const gps = restored.start("rpg", "gps");
  assert.equal((await restored.snapshot("rpg", gps.id)).progress.weaponLevel, 0);
});
