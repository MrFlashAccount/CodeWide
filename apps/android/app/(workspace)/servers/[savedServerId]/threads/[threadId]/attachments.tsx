import { useLocalSearchParams } from "expo-router";

import { AttachmentsScreen } from "../../../../../../src/v2/features/attachments/AttachmentsScreen";
import {
  requireSavedServerRouteParam,
  requireThreadRouteParam,
} from "../../../../../../src/v2/features/navigation/routeParams";
import { qualifiedThread } from "../../../../../../src/v2/domain/qualifiedThread";

export default function ThreadAttachmentsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    savedServerId?: string | string[];
    threadId?: string | string[];
  }>();
  return (
    <AttachmentsScreen
      owner={qualifiedThread(
        requireSavedServerRouteParam(params.savedServerId),
        requireThreadRouteParam(params.threadId),
      )}
    />
  );
}
