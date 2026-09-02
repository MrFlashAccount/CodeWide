import { Redirect, Stack, useLocalSearchParams } from "expo-router";

import { AttachmentsScreen } from "../../../../../../src/v2/features/attachments/AttachmentsScreen";
import { qualifiedThreadRouteParams } from "../../../../../../src/v2/features/navigation/routeParams";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
  presentation: "transparentModal",
} as const;

export default function ThreadAttachmentsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/attachments">();
  const owner = qualifiedThreadRouteParams(params);
  if (owner === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <AttachmentsScreen owner={owner} />
    </>
  );
}
