import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import type { PropsWithChildren } from "react";

import { PortProfileScreen } from "../../../../../src/v2/features/ports/PortProfileScreen";
import { BoundedTunnelSetupScreen } from "../../../../../src/v2/features/ports/BoundedTunnelSetupScreen";
import {
  opaqueRouteParam,
  savedServerRouteParam,
} from "../../../../../src/v2/features/navigation/routeParams";
import {
  PresentationSheetView,
  type PresentationSheetContentProps,
} from "../../../../../src/v2/presentation/surfaces/PresentationSheetView";
import { useEvent } from "../../../../../src/react/useEvent";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
  presentation: "transparentModal",
} as const;

const PORT_EDITOR_SHEET_PROPS: PresentationSheetContentProps = {
  contentContainerClassName: "h-full",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["90%"],
};

export default function PortRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/ports/[profileId]">();
  const profileId = opaqueRouteParam(params.profileId);
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (profileId === null || savedServerId === null) return <Redirect href="/servers" />;
  return (
    <PortEditorSheet>
      {profileId === "tunnel" ? (
        <BoundedTunnelSetupScreen savedServerId={savedServerId} />
      ) : (
        <PortProfileScreen profileId={profileId} savedServerId={savedServerId} />
      )}
    </PortEditorSheet>
  );
}

function PortEditorSheet(props: PropsWithChildren): React.JSX.Element {
  const close = useEvent(() => router.back());
  const changeOpen = useEvent((open: boolean) => {
    if (!open) close();
  });
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <PresentationSheetView
        contentProps={PORT_EDITOR_SHEET_PROPS}
        isOpen
        onOpenChange={changeOpen}
      >
        {props.children}
      </PresentationSheetView>
    </>
  );
}
