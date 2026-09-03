import { threadId } from "../../domain/ids";
import { qualifiedThread, type QualifiedThread } from "../../domain/qualifiedThread";

export function selectedAgentThread(
  owner: QualifiedThread,
  selectedAgentThreadId: string | null,
): QualifiedThread | null {
  return selectedAgentThreadId === null
    ? null
    : qualifiedThread(owner.savedServerId, threadId(selectedAgentThreadId));
}
