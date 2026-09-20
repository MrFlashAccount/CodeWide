import type { ContextType, ReactElement, ReactNode } from "react";
import { RouteFullscreenOverlay } from "../../components/navigation/RouteFullscreenOverlay";
import { useEvent } from "../../react/useEvent";
import {
  ConversationRouteNavigationContext,
  useConversationRouteNavigation,
} from "./conversationRouteNavigation";

type ConversationRouteFullscreenOverlayProps = Parameters<typeof RouteFullscreenOverlay>[0];

/** Preserves thread-route capabilities when content moves into the application overlay host. */
export function ConversationRouteFullscreenOverlay({
  onDismiss,
  render,
  scope,
}: ConversationRouteFullscreenOverlayProps): ReactElement {
  const navigation = useConversationRouteNavigation();
  const renderWithNavigation = useEvent((close: () => void) => (
    <ConversationRouteNavigationBoundary navigation={navigation}>
      {render(close)}
    </ConversationRouteNavigationBoundary>
  ));
  return (
    <RouteFullscreenOverlay onDismiss={onDismiss} render={renderWithNavigation} scope={scope} />
  );
}

/** Restores one captured thread-route capability below a detached overlay host. */
export function ConversationRouteNavigationBoundary({
  children,
  navigation,
}: {
  children: ReactNode;
  navigation: NonNullable<ContextType<typeof ConversationRouteNavigationContext>>;
}): ReactElement {
  return (
    <ConversationRouteNavigationContext.Provider value={navigation}>
      {children}
    </ConversationRouteNavigationContext.Provider>
  );
}
