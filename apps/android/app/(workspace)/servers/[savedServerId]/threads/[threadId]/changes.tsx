import { useLocalSearchParams } from "expo-router";

import { ChangesScreen } from "../../../../../../src/v2/features/changes/ChangesScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../src/v2/domain/qualifiedThread";

export default function ThreadChangesRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    savedServerId?: string | string[];
    threadId?: string | string[];
  }>();
  return (
    <ChangesScreen
      owner={qualifiedThread(
        requireSavedServerRouteParam(params.savedServerId),
        requireThreadRouteParam(params.threadId),
      )}
    />
  );
}
