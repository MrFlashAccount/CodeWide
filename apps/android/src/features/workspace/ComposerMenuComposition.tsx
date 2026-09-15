import SegmentedControl from "@expo/ui/community/segmented-control";
import { useState } from "react";
import {
  useBackgroundTerminalsRow,
  useThreadGoalRow,
  useTunnelRow,
} from "../../data/use-workspace-resource-row";
import { ResourceComposerMenu } from "../composer/ComposerMenu";
import { GoalFeature } from "../goal/GoalFeature";
import { useNativeForwardingAdapter } from "../ports/nativeForwardingAdapter";
import { PortsFeature } from "../ports/PortsFeature";
import { QueueManagerSheet } from "../queue/QueueFeature";
import { ReviewSheet } from "../review/ReviewTargetSheet";
import { BackgroundTerminalsSheet } from "../terminal/backgroundTerminals";
import { styles } from "./ComposerMenuComposition.styles";
import type { ComposerToolCapabilities } from "./composerToolCapabilities";
export function ComposerMenuComposition({
  queuedPrompts,
  activeTurnId,
  onBeginQueuedEdit,
  onCancelQueued,
  onMoveQueued,
  onSteerQueued,
  onListTerminals,
  onTerminateTerminal,
  onSetGoal,
  onClearGoal,
  onStartReview,
  onCreateTunnel,
  onRevokeTunnel,
  backgroundTerminalsResourceId,
  goalResourceId,
  tunnelResourceId,
  portForwardingConnectionId,
  portForwardingServerName,
  onOpenPortForward,
  resources,
  ...props
}: Omit<Parameters<typeof ResourceComposerMenu>[0], "toolPage" | "hideTitle"> &
  ComposerToolCapabilities) {
  const { initialPage: page, visible, onClose, voiceScope } = props;
  const terminalsResource = useBackgroundTerminalsRow(resources, backgroundTerminalsResourceId);
  const goalResource = useThreadGoalRow(resources, goalResourceId);
  const tunnelResource = useTunnelRow(resources, tunnelResourceId);
  const portForwarding = useNativeForwardingAdapter(
    portForwardingConnectionId,
    portForwardingServerName,
    onOpenPortForward,
  );
  const [runtimeSection, setRuntimeSection] = useState<"terminals" | "tunnel">(
    onListTerminals === undefined && onCreateTunnel !== undefined ? "tunnel" : "terminals",
  );

  const toolPage =
    page === "goal" ? (
      <GoalFeature
        visible={visible}
        onClose={onClose}
        goalResource={goalResource}
        voiceScope={voiceScope}
        {...(onSetGoal === undefined ? {} : { onSetGoal })}
        {...(onClearGoal === undefined ? {} : { onClearGoal })}
      />
    ) : page === "queue" ? (
      <QueueManagerSheet
        embedded
        visible
        onClose={onClose}
        items={queuedPrompts}
        activeTurnId={activeTurnId}
        {...(onBeginQueuedEdit === undefined ? {} : { onEdit: onBeginQueuedEdit })}
        {...(onCancelQueued === undefined ? {} : { onCancel: onCancelQueued })}
        {...(onMoveQueued === undefined ? {} : { onMove: onMoveQueued })}
        {...(onSteerQueued === undefined ? {} : { onSteer: onSteerQueued })}
      />
    ) : page === "review" ? (
      <ReviewSheet
        embedded
        visible
        onClose={onClose}
        {...(onStartReview === undefined ? {} : { onStartReview })}
      />
    ) : page === "ports" ? (
      <PortsFeature
        mode="forwarding"
        portForwarding={portForwarding}
        onClose={onClose}
        resource={tunnelResource}
      />
    ) : page === "runtime" ? (
      <>
        {onListTerminals !== undefined &&
          (portForwarding !== undefined || onCreateTunnel !== undefined) && (
            <SegmentedControl
              appearance="dark"
              values={["Terminal", "Ports"]}
              selectedIndex={runtimeSection === "terminals" ? 0 : 1}
              onValueChange={(value) => {
                const next = value === "Ports" ? "tunnel" : "terminals";
                setRuntimeSection(next);
                if (next === "terminals") void onListTerminals();
              }}
              style={styles.runtimeSelector}
            />
          )}
        {runtimeSection === "terminals" && onListTerminals !== undefined ? (
          <BackgroundTerminalsSheet
            embedded
            visible
            onClose={onClose}
            resource={terminalsResource}
            onList={onListTerminals}
            {...(onTerminateTerminal === undefined ? {} : { onTerminate: onTerminateTerminal })}
          />
        ) : (
          <PortsFeature
            mode="runtime"
            portForwarding={portForwarding}
            onClose={onClose}
            resource={tunnelResource}
            {...(onCreateTunnel === undefined ? {} : { onCreate: onCreateTunnel })}
            {...(onRevokeTunnel === undefined ? {} : { onRevoke: onRevokeTunnel })}
          />
        )}
      </>
    ) : null;
  return (
    <ResourceComposerMenu
      {...props}
      resources={resources}
      toolPage={toolPage}
      hideTitle={page === "ports" && portForwarding !== undefined}
    />
  );
}
