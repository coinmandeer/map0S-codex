import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { initDb, db } from "./db/index.js";
import { users, userLayers, userPins, gameZones, gameQuests } from "./db/schema.js";

async function seed() {
  await initDb();
  console.log("Seeding MapOS V3 travel demo…");

  const demoEmail = "demo@mapos.test";
  const [existing] = await db.select().from(users).where(eq(users.email, demoEmail)).limit(1);

  let userId: string;
  if (existing) {
    userId = existing.id;
    console.log("Demo user exists, skipping user create");
  } else {
    const passwordHash = await bcrypt.hash("demo1234", 10);
    const [user] = await db
      .insert(users)
      .values({
        email: demoEmail,
        passwordHash,
        displayName: "MapOS Demo"
      })
      .returning();
    userId = user!.id;
    console.log("Created demo user: demo@mapos.test / demo1234");
  }

  const [existingLayer] = await db
    .select()
    .from(userLayers)
    .where(eq(userLayers.slug, "plzen-tipy"))
    .limit(1);
  if (!existingLayer) {
    const [layer] = await db
      .insert(userLayers)
      .values({
        userId,
        name: "Plzeň tipy",
        color: "#10b981",
        slug: "plzen-tipy",
        isPublic: 1
      })
      .returning();

    await db.insert(userPins).values([
      {
        layerId: layer!.id,
        name: "Pivovarske muzeum",
        lng: 13.3775,
        lat: 49.7475,
        description: "Plzensky Prazdroj",
        tags: ["hidden-gem", "gastro"],
        kind: "place",
        country: "CZ",
        authorName: "MapOS Demo"
      },
      {
        layerId: layer!.id,
        name: "Svaty Bartolomej",
        lng: 13.3773,
        lat: 49.7472,
        description: "Katedrala na namesti",
        tags: ["viewpoint", "culture"],
        kind: "place",
        country: "CZ",
        authorName: "MapOS Demo"
      },
      {
        layerId: layer!.id,
        name: "Riegrovy sady",
        lng: 13.382,
        lat: 49.7505,
        description: "Park s vyhlidkou",
        tags: ["quiet-corner", "vanlife"],
        kind: "route",
        country: "CZ",
        authorName: "MapOS Demo"
      }
    ]);
    console.log("Created demo user layer: plzen-tipy");
  }

  const [existingZone] = await db.select().from(gameZones).limit(1);
  if (!existingZone) {
    const zones = await db
      .insert(gameZones)
      .values([
        {
          name: "Plzen centrum",
          lng: 13.3775,
          lat: 49.7475,
          radiusM: 300,
          description: "Historicke centrum",
          lootTier: "medium",
          lootTable: ["tram ticket", "river glass"],
          zoneKind: "standard"
        },
        {
          name: "Bolevec",
          lng: 13.395,
          lat: 49.765,
          radiusM: 250,
          description: "Rekreacni oblast",
          lootTier: "low",
          lootTable: ["pine cone"],
          zoneKind: "standard"
        },
        {
          name: "Karlstejn okoli",
          lng: 14.188,
          lat: 49.939,
          radiusM: 400,
          description: "Hradni zona",
          lootTier: "high",
          lootTable: ["gotchi rune", "aether shard"],
          zoneKind: "staker_gate",
          minStakeUsd: 10
        },
        {
          name: "Namesti Republiky",
          lng: 13.3778,
          lat: 49.7478,
          radiusM: 180,
          description: "Event zona",
          lootTier: "high",
          lootTable: ["festival badge"],
          zoneKind: "event",
          activeFrom: new Date(Date.now() - 86400000),
          activeUntil: new Date(Date.now() + 7 * 86400000)
        }
      ])
      .returning();

    await db.insert(gameQuests).values([
      {
        zoneId: zones[0]!.id,
        title: "Najdi katedrálu",
        description: "Navštiv Svatého Bartoloměje",
        rewardPoints: 25,
        lng: 13.3773,
        lat: 49.7472
      },
      {
        zoneId: zones[0]!.id,
        title: "Pivní stezka",
        description: "Projdi kolem pivovaru",
        rewardPoints: 15,
        lng: 13.378,
        lat: 49.748
      },
      {
        zoneId: zones[2]!.id,
        title: "Hradní průzkum",
        description: "Dostaň se k hradu Karlštejn",
        rewardPoints: 50,
        lng: 14.188,
        lat: 49.939
      }
    ]);
    console.log("Created game zones and quests");
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
