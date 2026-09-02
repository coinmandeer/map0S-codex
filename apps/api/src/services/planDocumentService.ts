/**
 * API compatibility barrel. The command engine lives in the SDK so browser drafts, API routes
 * and future AI tools all enforce the same revision and adjacent-segment rules.
 */
export {
  PlanCommandError,
  applyPlanCommand,
  reconcileAdjacentPlanSegments,
  restorePlanSnapshot,
  type ApplyPlanCommandOptions,
  type ApplyPlanCommandResult,
  type SegmentReconcileOptions,
  type SegmentReconcileResult
} from "@mapos/layer-sdk";
