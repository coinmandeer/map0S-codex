export type SourceRights =
  "open" | "restricted-display" | "restricted-export" | "private" | "unknown";

export interface SourceRecordV2 {
  providerId: string;
  sourceId: string;
  originalUrl?: string;
  retrievedAt: string;
  confidence: number;
  /** Advisory provenance label; absence never hides prototype data. */
  attribution?: string;
  license?: string | null;
  /** Advisory source-rights classification. */
  rights?: SourceRights;
  fieldPaths?: string[];
  rawRef?: string | null;
}

export type FeatureVisibilityV2 = "public" | "unlisted" | "private" | "entitled";
export type FeaturePermissionV2 =
  "view" | "comment" | "review" | "edit" | "share" | "export" | "moderate";

export interface FeatureAccessV2 {
  visibility: FeatureVisibilityV2;
  ownerId?: string | null;
  permissions?: FeaturePermissionV2[];
  entitlementId?: string | null;
}
