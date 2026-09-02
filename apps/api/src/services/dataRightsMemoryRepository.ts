import { memoryDb } from "../db/memory.js";
import type { MemoryIdentityRepository } from "./identity/identityService.js";
import type {
  AccountDeletionResult,
  AccountExportData,
  DataRightsRecord,
  DataRightsRepository
} from "./dataRightsService.js";

function cloneRecord(value: unknown): DataRightsRecord {
  return structuredClone(value) as DataRightsRecord;
}

function removeWhere<T>(rows: T[], predicate: (row: T) => boolean): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index]!)) rows.splice(index, 1);
  }
}

/** Offline adapter. Commerce is intentionally absent because fixture mode has no persistent
 * payment provider; production export/deletion is implemented by the Postgres adapter. */
export class MemoryDataRightsRepository implements DataRightsRepository {
  constructor(private readonly identities?: MemoryIdentityRepository) {}

  async exportForOwner(userId: string): Promise<AccountExportData | null> {
    const user = memoryDb.users.find((candidate) => candidate.id === userId);
    if (!user) return null;
    const ownedLayers = memoryDb.userLayers.filter((layer) => layer.userId === userId);
    const profiles = [...memoryDb.gameProfiles.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, state]) => ({ gameId: key.slice(userId.length + 1), state }));

    return {
      account: {
        id: user.id,
        email: user.isGuest ? null : user.email,
        displayName: user.displayName,
        isGuest: user.isGuest,
        xpTotal: user.xpTotal
      },
      identities: this.identities
        ? [...this.identities.identities.values()]
            .filter((identity) => identity.userId === userId)
            .map(({ userId: _owner, ...identity }) => cloneRecord(identity))
        : [],
      layers: ownedLayers.map(({ userId: _owner, ...layer }) => ({
        ...cloneRecord(layer),
        pins: memoryDb.pins.filter((pin) => pin.layerId === layer.id).map((pin) => cloneRecord(pin))
      })),
      layerImports: [],
      places: {
        saved: memoryDb.savedPlaces
          .filter((place) => place.userId === userId)
          .map(({ userId: _owner, ...place }) => cloneRecord(place)),
        collections: memoryDb.savedPlaceCollections
          .filter((collection) => collection.userId === userId)
          .map(({ userId: _owner, ...collection }) => cloneRecord(collection))
      },
      plans: [
        ...memoryDb.tripPlans
          .filter((row) => row.userId === userId)
          .map((row) => cloneRecord(row.plan)),
        ...memoryDb.planDocuments
          .filter((row) => row.userId === userId)
          .map((row) => cloneRecord(row.plan))
      ],
      planCollaboration: {
        shares: memoryDb.planShareLinks
          .filter((row) => row.ownerId === userId)
          .map(({ ownerId: _owner, tokenHash: _tokenHash, ...share }) => cloneRecord(share)),
        discussions: memoryDb.planDiscussionThreads
          .filter((row) => row.ownerId === userId)
          .map(({ ownerId: _owner, thread }) => cloneRecord(thread))
      },
      social: {
        follows: memoryDb.follows
          .filter((row) => row.userId === userId)
          .map(({ userId: _owner, ...row }) => cloneRecord(row)),
        reviews: memoryDb.reviews
          .filter((row) => row.userId === userId)
          .map(({ userId: _owner, ...row }) => cloneRecord(row)),
        comments: memoryDb.comments
          .filter((row) => row.userId === userId)
          .map(({ userId: _owner, ...row }) => cloneRecord(row)),
        drafts: memoryDb.drafts
          .filter((row) => row.userId === userId)
          .map((row) => cloneRecord(row.payload))
      },
      game: {
        questCompletions: [...(memoryDb.questCompletions.get(userId) ?? [])].map((questId) => ({
          questId
        })),
        orbCollections: [...(memoryDb.collectedOrbs.get(userId) ?? [])].map((orbId) => ({ orbId })),
        profiles: profiles.map(cloneRecord),
        staking: [],
        rewards: [],
        caughtGhosts: [],
        encounters: []
      },
      commerce: { orders: [], subscriptions: [], entitlements: [], tips: [] }
    };
  }

  async deleteForOwner(userId: string): Promise<AccountDeletionResult | null> {
    const userIndex = memoryDb.users.findIndex((candidate) => candidate.id === userId);
    if (userIndex < 0) return null;

    const layerIds = new Set(
      memoryDb.userLayers.filter((layer) => layer.userId === userId).map((layer) => layer.id)
    );
    removeWhere(memoryDb.pins, (pin) => layerIds.has(pin.layerId));
    removeWhere(memoryDb.userLayers, (layer) => layer.userId === userId);
    removeWhere(memoryDb.tripPlans, (row) => row.userId === userId);
    removeWhere(memoryDb.planDocuments, (row) => row.userId === userId);
    removeWhere(memoryDb.planShareLinks, (row) => row.ownerId === userId);
    removeWhere(memoryDb.planDiscussionThreads, (row) => row.ownerId === userId);
    removeWhere(memoryDb.follows, (row) => row.userId === userId);
    removeWhere(memoryDb.reviews, (row) => row.userId === userId);
    removeWhere(memoryDb.comments, (row) => row.userId === userId);
    removeWhere(memoryDb.drafts, (row) => row.userId === userId);
    removeWhere(memoryDb.savedPlaces, (row) => row.userId === userId);
    removeWhere(memoryDb.savedPlaceCollections, (row) => row.userId === userId);
    for (const [sessionId, session] of memoryDb.sessions) {
      if (session.userId === userId) memoryDb.sessions.delete(sessionId);
    }
    memoryDb.questCompletions.delete(userId);
    memoryDb.collectedOrbs.delete(userId);
    for (const key of memoryDb.gameProfiles.keys()) {
      if (key.startsWith(`${userId}:`)) memoryDb.gameProfiles.delete(key);
    }
    if (this.identities) {
      for (const [id, identity] of this.identities.identities) {
        if (identity.userId === userId) this.identities.identities.delete(id);
      }
      for (const [id, challenge] of this.identities.challenges) {
        if (challenge.userId === userId) this.identities.challenges.delete(id);
      }
      removeWhere(this.identities.audits, (audit) => audit.userId === userId);
    }
    memoryDb.users.splice(userIndex, 1);
    return { status: "deleted", retained: [] };
  }
}
