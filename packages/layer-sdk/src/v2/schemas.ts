import maposFeatureSchema from "./schemas/mapos-feature.schema.json" with { type: "json" };
import layerManifestSchema from "./schemas/layer-manifest.schema.json" with { type: "json" };
import taskRecordSchema from "./schemas/task-record.schema.json" with { type: "json" };
import eventDocumentSchema from "./schemas/event-document.schema.json" with { type: "json" };
import entitlementSchema from "./schemas/entitlement.schema.json" with { type: "json" };
import layerPackageSchema from "./schemas/layer-package.schema.json" with { type: "json" };

/** Draft 2020-12 schemas used by fixtures, partner tooling and server contract tests. */
export const MAPOS_FEATURE_V2_SCHEMA = maposFeatureSchema;
export const LAYER_MANIFEST_V2_SCHEMA = layerManifestSchema;
export const TASK_RECORD_V2_SCHEMA = taskRecordSchema;
export const EVENT_DOCUMENT_V2_SCHEMA = eventDocumentSchema;
export const ENTITLEMENT_V2_SCHEMA = entitlementSchema;
export const LAYER_PACKAGE_V2_SCHEMA = layerPackageSchema;
