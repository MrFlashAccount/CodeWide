import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";
import { View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { browserTabCatalog } from "../../services/browser/browserTabCatalog";
import { browserPresentation } from "../../services/browser/browserPresentation";
import type { BrowserTabsModel } from "../../services/browser/browserTabsModel";
import {
  threadSelectionKey,
  type V1ThreadRouteParams,
} from "../../services/threads/threadRouteParams";
import { BrowserFeedbackContext } from "./BrowserFeedbackContext";
import type { BrowserFeedbackCapability } from "./feedback";
import { BrowserWorkspace } from "./BrowserWorkspace";
import { styles } from "./BrowserWorkspaceHost.styles";
import {
  BrowserHomeContentContext,
  type BrowserHomeContentRenderer,
} from "./BrowserHomeContentContext";

/** Keeps browser pages attached to the persistent workspace, including while collapsed. */
export function BrowserWorkspaceHost(props: {
  readonly bottomInset?: number;
  readonly feedback?: Omit<BrowserFeedbackCapability, "initialDestination">;
  readonly renderHome?: BrowserHomeContentRenderer;
  readonly topInset?: number;
}): React.JSX.Element {
  const state = useSelector(browserPresentation.state$);
  const dismiss = useEvent(() => browserPresentation.state$.peek().visible?.onDismiss());
  useEffect(
    () => () => {
      browserPresentation.clear();
    },
    [],
  );
  return (
    <View
      accessibilityElementsHidden={state.visible === null}
      collapsable={false}
      importantForAccessibility={state.visible === null ? "no-hide-descendants" : "auto"}
      pointerEvents={state.visible === null ? "none" : "auto"}
      style={[
        styles.host,
        { bottom: props.bottomInset ?? 0, top: props.topInset ?? 0 },
        state.visible === null && styles.hidden,
      ]}
      testID="browser-workspace-host"
    >
      {state.entries.map((entry) => (
        <RetainedBrowserWorkspace
          active={state.visible?.tabs === entry.tabs}
          feedback={props.feedback}
          initialView={state.visible?.tabs === entry.tabs ? state.visible.initialView : "page"}
          key={entry.tabs.id}
          onClose={dismiss}
          presentationId={state.visible?.tabs === entry.tabs ? state.visible.sessionId : null}
          renderHome={props.renderHome}
          tabs={entry.tabs}
          thread={entry.thread}
        />
      ))}
    </View>
  );
}

function RetainedBrowserWorkspace(props: {
  readonly active: boolean;
  readonly feedback: Omit<BrowserFeedbackCapability, "initialDestination"> | undefined;
  readonly initialView: "page" | "tabs";
  readonly onClose: () => void;
  readonly presentationId: string | null;
  readonly renderHome: BrowserHomeContentRenderer | undefined;
  readonly tabs: BrowserTabsModel;
  readonly thread: V1ThreadRouteParams | null;
}): React.JSX.Element {
  useEffect(
    () => (props.thread === null ? undefined : browserTabCatalog.retain(props.thread)),
    [props.thread],
  );
  const feedback =
    props.feedback === undefined
      ? null
      : {
          ...props.feedback,
          initialDestination:
            props.thread === null
              ? ""
              : threadSelectionKey({
                  id: props.thread.threadId.value,
                  serverId: props.thread.connectionId.value,
                }),
        };
  return (
    <BrowserFeedbackContext.Provider value={feedback}>
      <BrowserHomeContentContext.Provider value={homeContentValue(props.thread, props.renderHome)}>
        <BrowserWorkspaceSurface {...props} />
      </BrowserHomeContentContext.Provider>
    </BrowserFeedbackContext.Provider>
  );
}

function homeContentValue(
  thread: V1ThreadRouteParams | null,
  render: BrowserHomeContentRenderer | undefined,
): React.ContextType<typeof BrowserHomeContentContext> {
  return render === undefined ? null : { connectionId: thread?.connectionId.value ?? null, render };
}

function BrowserWorkspaceSurface(props: {
  readonly active: boolean;
  readonly initialView: "page" | "tabs";
  readonly onClose: () => void;
  readonly presentationId: string | null;
  readonly tabs: BrowserTabsModel;
}): React.JSX.Element {
  return (
    <View
      accessibilityElementsHidden={!props.active}
      importantForAccessibility={props.active ? "auto" : "no-hide-descendants"}
      pointerEvents={props.active ? "auto" : "none"}
      style={[styles.workspace, !props.active && styles.hidden]}
    >
      <BrowserWorkspace
        active={props.active}
        initialView={props.initialView}
        onClose={props.onClose}
        presentationId={props.presentationId ?? props.tabs.id}
        tabs={props.tabs}
      />
    </View>
  );
}
