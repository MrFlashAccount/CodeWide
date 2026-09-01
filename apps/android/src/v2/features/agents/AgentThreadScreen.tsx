import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ConversationScreen } from "../conversation/ConversationScreen";

interface AgentThreadScreenProps {
  onBack(): void;
  onOpenPorts(): void | Promise<void>;
  onOpenResource(
    resourceName: "agents" | "attachments" | "changes" | "terminal",
  ): void | Promise<void>;
  owner: QualifiedThread;
}

export function AgentThreadScreen({
  onBack,
  onOpenPorts,
  onOpenResource,
  owner,
}: AgentThreadScreenProps): React.JSX.Element {
  return (
    <ConversationScreen
      onBack={onBack}
      onOpenPorts={onOpenPorts}
      onOpenResource={onOpenResource}
      owner={owner}
    />
  );
}
