import { useState } from "react";
import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { StyleSheet } from "react-native";

import type { ComposerToolRouteRequest } from "../../services/composer/composerToolRouteSession";
import { useBackgroundTerminalsRow, useTunnelRow } from "../../data/use-workspace-resource-row";
import { AppSheet } from "../../ui/AppSheet";
import { PortsFeature } from "../ports/PortsFeature";
import { useNativeForwardingAdapter } from "../ports/nativeForwardingAdapter";
import { BackgroundTerminalsSheet } from "../terminal/backgroundTerminals";
import { spacing } from "../../theme";

type RuntimeRouteRequest = Extract<ComposerToolRouteRequest, { readonly kind: "runtime" }>;
type RuntimeSection = "ports" | "terminals";

const RUNTIME_SECTION_LABELS = ["Terminal", "Ports"];
const TOOL_SHEET_PROPS: React.ComponentProps<typeof AppSheet>["contentProps"] = {
  contentContainerClassName: "h-full",
  dismissLabel: "Close tool",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

const PORTS_TOOL_SHEET_PROPS: React.ComponentProps<typeof AppSheet>["contentProps"] = {
  contentContainerClassName: "h-full",
  dismissLabel: "Close tool",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  performanceSurface: "ports",
  snapPoints: ["55%", "90%"],
};

/** Presents native port forwarding as a dedicated route-owned sheet. */
export function ComposerPortsRoute({
  onClose,
  request,
  visible,
}: {
  readonly onClose: () => void;
  readonly request: Extract<ComposerToolRouteRequest, { readonly kind: "ports" }>;
  readonly visible: boolean;
}): React.JSX.Element {
  const resource = useTunnelRow(request.resources, request.tunnelResourceId);
  const forwarding = useNativeForwardingAdapter(
    request.connectionId,
    request.serverName,
    request.openBrowser,
  );
  return (
    <ToolSheet onClose={onClose} performanceSurface="ports" visible={visible}>
      <PortsFeature
        mode="forwarding"
        onClose={onClose}
        {...(request.openBrowser === undefined ? {} : { onOpenBrowser: request.openBrowser })}
        portForwarding={forwarding}
        resource={resource}
      />
    </ToolSheet>
  );
}

const styles = StyleSheet.create({
  runtimeSelector: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});

/** Presents retained background terminals and tunnels without tying them to route lifetime. */
export function ComposerRuntimeRoute({
  onClose,
  request,
  visible,
}: {
  readonly onClose: () => void;
  readonly request: RuntimeRouteRequest;
  readonly visible: boolean;
}): React.JSX.Element {
  const terminals = useBackgroundTerminalsRow(
    request.resources,
    request.backgroundTerminalsResourceId,
  );
  const tunnel = useTunnelRow(request.resources, request.tunnelResourceId);
  const forwarding = useNativeForwardingAdapter(
    request.connectionId,
    request.serverName,
    request.openBrowser,
  );
  const [section, setSection] = useState<"terminals" | "ports">(
    request.listTerminals === undefined ? "ports" : "terminals",
  );
  const supportsSectionSelection =
    request.listTerminals !== undefined &&
    (forwarding !== undefined || request.createTunnel !== undefined);
  return (
    <ToolSheet
      onClose={onClose}
      performanceSurface={section === "ports" ? "ports" : "sheet"}
      visible={visible}
    >
      <RuntimeSectionSelector
        request={request}
        section={section}
        setSection={setSection}
        visible={supportsSectionSelection}
      />
      <RuntimeSectionContent
        forwarding={forwarding}
        onClose={onClose}
        request={request}
        section={section}
        terminals={terminals}
        tunnel={tunnel}
      />
    </ToolSheet>
  );
}

function RuntimeSectionSelector({
  request,
  section,
  setSection,
  visible,
}: {
  readonly request: RuntimeRouteRequest;
  readonly section: RuntimeSection;
  readonly setSection: (section: RuntimeSection) => void;
  readonly visible: boolean;
}): React.JSX.Element | null {
  if (!visible) {
    return null;
  }
  return (
    <SegmentedControl
      appearance="dark"
      onValueChange={(value) => {
        const next = value === "Ports" ? "ports" : "terminals";
        setSection(next);
        if (next === "terminals") {
          void request.listTerminals?.().catch(() => undefined);
        }
      }}
      selectedIndex={section === "terminals" ? 0 : 1}
      style={styles.runtimeSelector}
      values={RUNTIME_SECTION_LABELS}
    />
  );
}

function RuntimeSectionContent({
  forwarding,
  onClose,
  request,
  section,
  terminals,
  tunnel,
}: {
  readonly forwarding: ReturnType<typeof useNativeForwardingAdapter>;
  readonly onClose: () => void;
  readonly request: RuntimeRouteRequest;
  readonly section: RuntimeSection;
  readonly terminals: ReturnType<typeof useBackgroundTerminalsRow>;
  readonly tunnel: ReturnType<typeof useTunnelRow>;
}): React.JSX.Element {
  if (section === "terminals" && request.listTerminals !== undefined) {
    return (
      <BackgroundTerminalsSheet
        embedded
        onClose={onClose}
        onList={request.listTerminals}
        resource={terminals}
        visible
        {...(request.terminateTerminal === undefined
          ? {}
          : { onTerminate: request.terminateTerminal })}
      />
    );
  }
  return (
    <PortsFeature
      mode="runtime"
      onClose={onClose}
      {...(request.openBrowser === undefined ? {} : { onOpenBrowser: request.openBrowser })}
      portForwarding={forwarding}
      resource={tunnel}
      {...(request.createTunnel === undefined ? {} : { onCreate: request.createTunnel })}
      {...(request.revokeTunnel === undefined ? {} : { onRevoke: request.revokeTunnel })}
    />
  );
}

function ToolSheet({
  children,
  onClose,
  performanceSurface,
  visible,
}: {
  readonly children: React.ReactNode;
  readonly onClose: () => void;
  readonly performanceSurface: "ports" | "sheet";
  readonly visible: boolean;
}): React.JSX.Element {
  return (
    <AppSheet
      contentProps={performanceSurface === "ports" ? PORTS_TOOL_SHEET_PROPS : TOOL_SHEET_PROPS}
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {children}
    </AppSheet>
  );
}
