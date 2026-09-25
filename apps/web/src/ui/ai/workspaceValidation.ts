import { isConversationWorkspaceData } from "@mapos/layer-sdk";
import type { ConversationWorkspace } from "./mapScene";
export function isConversationWorkspace(value: unknown): value is ConversationWorkspace {
  return isConversationWorkspaceData(value);
}
