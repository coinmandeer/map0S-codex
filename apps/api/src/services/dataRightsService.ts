export type DataRightsRecord = Record<string, unknown>;

export interface AccountExportData {
  account: DataRightsRecord;
  identities: DataRightsRecord[];
  layers: DataRightsRecord[];
  layerImports: DataRightsRecord[];
  places: {
    saved: DataRightsRecord[];
    collections: DataRightsRecord[];
  };
  plans: DataRightsRecord[];
  planCollaboration?: {
    shares: DataRightsRecord[];
    discussions: DataRightsRecord[];
  };
  social: {
    follows: DataRightsRecord[];
    reviews: DataRightsRecord[];
    comments: DataRightsRecord[];
    drafts: DataRightsRecord[];
  };
  game: {
    questCompletions: DataRightsRecord[];
    orbCollections: DataRightsRecord[];
    profiles: DataRightsRecord[];
    staking: DataRightsRecord[];
    rewards: DataRightsRecord[];
    caughtGhosts: DataRightsRecord[];
    encounters: DataRightsRecord[];
  };
  commerce: {
    orders: DataRightsRecord[];
    subscriptions: DataRightsRecord[];
    entitlements: DataRightsRecord[];
    tips: DataRightsRecord[];
  };
}

export interface RetentionException {
  domain: "commerce-audit";
  reason: "legal-and-financial-record";
  dataState: "pseudonymized-and-deactivated";
}

export interface AccountDeletionResult {
  status: "deleted" | "deleted-with-retention";
  retained: RetentionException[];
}

export interface DataRightsRepository {
  exportForOwner(userId: string): Promise<AccountExportData | null>;
  deleteForOwner(userId: string): Promise<AccountDeletionResult | null>;
}

export interface AccountExportV1 extends AccountExportData {
  schema: "mapos.account-export";
  schemaVersion: "1.0.0";
  generatedAt: string;
  policyVersion: "2026-09-01";
  exclusions: readonly [
    "password-hashes",
    "sessions-and-cookies",
    "authentication-challenges",
    "provider-secrets-and-payment-payloads",
    "security-and-rate-limit-records"
  ];
}

export class DataRightsNotFoundError extends Error {
  readonly name = "DataRightsNotFoundError";
}

/** Owner-scoped orchestration. Repositories deliberately return only the allow-listed export
 * shape; adding a database column cannot accidentally make it downloadable. */
export class DataRightsService {
  constructor(
    private readonly repository: DataRightsRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async exportAccount(userId: string): Promise<AccountExportV1> {
    const data = await this.repository.exportForOwner(userId);
    if (!data) throw new DataRightsNotFoundError("Account not found");
    return {
      schema: "mapos.account-export",
      schemaVersion: "1.0.0",
      generatedAt: this.now().toISOString(),
      policyVersion: "2026-09-01",
      exclusions: [
        "password-hashes",
        "sessions-and-cookies",
        "authentication-challenges",
        "provider-secrets-and-payment-payloads",
        "security-and-rate-limit-records"
      ],
      ...structuredClone(data)
    };
  }

  async deleteAccount(userId: string): Promise<AccountDeletionResult> {
    const result = await this.repository.deleteForOwner(userId);
    if (!result) throw new DataRightsNotFoundError("Account not found");
    return structuredClone(result);
  }
}
