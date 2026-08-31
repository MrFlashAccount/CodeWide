import { useLocalSearchParams } from "expo-router";

import { TerminalScreen } from "../../../../../../src/v2/features/terminal/TerminalScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../src/v2/domain/qualifiedThread";

export default function ThreadTerminalRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    savedServerId?: string | string[];
    threadId?: string | string[];
  }>();
  return (
    <TerminalScreen
      owner={qualifiedThread(
        requireSavedServerRouteParam(params.savedServerId),
        requireThreadRouteParam(params.threadId),
      )}
    />
  );
}
