import type { QualifiedThread } from "../../domain/qualifiedThread";
import { AgentsScreen } from "./AgentsScreen";

interface AgentThreadScreenProps {
  owner: QualifiedThread;
  selectedAgentThreadId: string;
}

export function AgentThreadScreen(props: AgentThreadScreenProps): React.JSX.Element {
  const { owner, selectedAgentThreadId } = props;
  return <AgentsScreen owner={owner} selectedAgentThreadId={selectedAgentThreadId} />;
}
