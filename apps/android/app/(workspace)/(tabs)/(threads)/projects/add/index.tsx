import { useIsFocused, useRouter } from "expo-router";

import { useEvent } from "../../../../../../src/react/useEvent";
import { AddProjectSheet } from "../../../../../../src/routeComposition/ProjectManagementSheets";

/** Starts project addition at the server catalogue without choosing a destination implicitly. */
export default function V1AddProjectServersRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const close = useEvent(() => {
    router.dismissTo("/projects");
  });
  return <AddProjectSheet initialConnectionId={null} onClose={close} visible={visible} />;
}
