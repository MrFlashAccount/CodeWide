import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ConversationScreen } from "../conversation/ConversationScreen";

interface AgentThreadScreenProps {
  onOpenResource(
    resourceName: "agents" | "attachments" | "changes" | "terminal",
  ): void | Promise<void>;
  owner: QualifiedThread;
}

export function AgentThreadScreen({
  onOpenResource,
  owner,
}: AgentThreadScreenProps): React.JSX.Element {
  return <ConversationScreen onOpenResource={onOpenResource} owner={owner} />;
}
