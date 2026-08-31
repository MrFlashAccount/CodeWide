import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ConversationScreen } from "../conversation/ConversationScreen";

export function AgentThreadScreen({
  onOpenResource,
  owner,
}: {
  onOpenResource(
    resourceName: "agents" | "attachments" | "changes" | "terminal",
  ): void | Promise<void>;
  owner: QualifiedThread;
}): React.JSX.Element {
  return <ConversationScreen onOpenResource={onOpenResource} owner={owner} />;
}
