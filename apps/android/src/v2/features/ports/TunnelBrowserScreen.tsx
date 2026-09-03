import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useRef, useState, useSyncExternalStore, useTransition, type ComponentType } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../V2Application";
import type { LocalhostBrowserSession } from "../../application/ports/localhostBrowser";
import type { TunnelLifecycleProps } from "../../application/ports/tunnelLifecycle";
import type { SavedServerId } from "../../domain/ids";
import type { InternalBrowserContentProps } from "../../presentation/browser/InternalBrowserView";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, spacing, touchTarget, typeScale } from "../../theme";

interface TunnelBrowserScreenProps {
  browser: ComponentType<InternalBrowserContentProps>;
  initialSession: LocalhostBrowserSession;
  lifecycle: ComponentType<TunnelLifecycleProps>;
  savedServerId: SavedServerId;
}

type TunnelAction = "close" | "dispose" | "reconnect";

interface TunnelActionFailure {
  action: TunnelAction;
  message: string;
}

export function TunnelBrowserScreen(props: TunnelBrowserScreenProps): React.JSX.Element {
  const { browser, initialSession, lifecycle: Lifecycle, savedServerId } = props;
  const runtime = useV2Runtime();
  const ports = runtime.ports(savedServerId);
  const [session, setSession] = useState(initialSession);
  const [expired, setExpired] = useState(() => initialSession.expiresAt <= runtime.now());
  const [failure, setFailure] = useState<TunnelActionFailure | null>(null);
  const [activeAction, setActiveAction] = useState<TunnelAction | null>(null);
  const [pending, startAction] = useTransition();
  const actionLocked = useRef(false);
  const revokedTunnelId = useRef<string | null>(null);
  const expire = useEvent(() => setExpired(true));
  const revoke = useEvent(async (tunnelId: string): Promise<void> => {
    if (revokedTunnelId.current === tunnelId) return;
    await ports.deleteTunnel(tunnelId);
    revokedTunnelId.current = tunnelId;
  });
  const runAction = useEvent((action: TunnelAction, tunnelId: string) => {
    if (actionLocked.current) return;
    actionLocked.current = true;
    setActiveAction(action);
    setFailure(null);
    startAction(async () => {
      let stage: "create" | "revoke" = "revoke";
      try {
        await revoke(tunnelId);
        if (action === "close") {
          router.back();
        } else if (action === "reconnect") {
          stage = "create";
          const tunnel = await ports.createTunnel(session.port, 3600);
          setSession({
            expiresAt: tunnel.expiresAt,
            label: session.label,
            port: session.port,
            sourcePath: `${tunnel.basePath}${session.suffix}`,
            suffix: session.suffix,
            tunnelId: tunnel.id,
          });
          setExpired(false);
        }
      } catch (cause) {
        setFailure({
          action,
          message: message(
            cause,
            stage === "revoke"
              ? "Could not revoke bounded tunnel."
              : "Could not reconnect bounded tunnel.",
          ),
        });
      }
      actionLocked.current = false;
      setActiveAction(null);
    });
  });
  const close = useEvent(() => runAction("close", session.tunnelId));
  const dispose = useEvent((tunnelId: string) => {
    if (actionLocked.current || revokedTunnelId.current === tunnelId) return;
    runAction("dispose", tunnelId);
  });
  const lifecycleProps: TunnelLifecycleProps = {
    expiresAt: session.expiresAt,
    now: runtime.now,
    onDispose: dispose,
    onExpire: expire,
    tunnelId: session.tunnelId,
  };
  const reconnect = useEvent(() => runAction("reconnect", session.tunnelId));
  const retry = useEvent(() => {
    if (failure === null) {
      reconnect();
      return;
    }
    runAction(failure.action, session.tunnelId);
  });
  const actionPending = pending || activeAction !== null;
  if (expired || failure !== null || actionPending) {
    return (
      <>
        <Lifecycle {...lifecycleProps} />
        <TunnelUnavailable
          error={failure?.message ?? "This bounded tunnel expired."}
          onClose={close}
          onRetry={retry}
          pending={actionPending}
          pendingText={
            activeAction === "reconnect"
              ? "Reconnecting bounded tunnel…"
              : "Revoking bounded tunnel…"
          }
          retryLabel={
            failure?.action === "close" ||
            failure?.action === "dispose" ||
            activeAction === "close" ||
            activeAction === "dispose"
              ? "Retry revoke"
              : "Reconnect"
          }
        />
      </>
    );
  }
  return (
    <>
      <Lifecycle {...lifecycleProps} />
      <LoadedTunnelBrowser
        browser={browser}
        key={session.sourcePath}
        onClose={close}
        onFailure={expire}
        onReconnect={reconnect}
        savedServerId={savedServerId}
        session={session}
      />
    </>
  );
}

interface LoadedTunnelBrowserProps {
  browser: ComponentType<InternalBrowserContentProps>;
  onClose(): void;
  onFailure(): void;
  onReconnect(): void;
  savedServerId: SavedServerId;
  session: LocalhostBrowserSession;
}

function LoadedTunnelBrowser(props: LoadedTunnelBrowserProps): React.JSX.Element {
  const { browser: Browser, onClose, onFailure, onReconnect, savedServerId, session } = props;
  const runtime = useV2Runtime();
  const [preview] = useState(() => runtime.preview(savedServerId, session.sourcePath, "web"));
  const snapshot = useSyncExternalStore(preview.subscribe, preview.snapshot, preview.snapshot);
  const reportError = useEvent(() => onFailure());
  if (snapshot.status === "loading") return <TunnelLoading onClose={onClose} />;
  if (snapshot.status === "error" || snapshot.value.stream === null) {
    const detail =
      snapshot.status === "error" ? snapshot.message : "Tunnel preview is unavailable.";
    return (
      <TunnelUnavailable
        error={detail}
        onClose={onClose}
        onRetry={onReconnect}
        pending={false}
        pendingText="Reconnecting bounded tunnel…"
        retryLabel="Reconnect"
      />
    );
  }
  return (
    <Browser
      onClose={onClose}
      onError={reportError}
      onHttpError={reportError}
      source={snapshot.value.stream}
      status="Bounded"
      title={session.label}
    />
  );
}

interface TunnelUnavailableProps {
  error: string;
  onClose(): void;
  onRetry(): void;
  pending: boolean;
  pendingText: string;
  retryLabel: "Reconnect" | "Retry revoke";
}

interface TunnelLoadingProps {
  onClose(): void;
}

interface CloseButtonProps {
  disabled?: boolean;
  onPress(): void;
}

function TunnelUnavailable(props: TunnelUnavailableProps): React.JSX.Element {
  const { error, onClose, onRetry, pending, pendingText, retryLabel } = props;
  return (
    <View accessibilityState={{ busy: pending }} style={styles.root}>
      <CloseButton disabled={pending} onPress={onClose} />
      <View style={styles.center}>
        {pending ? (
          <ShimmerText text={pendingText} />
        ) : (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Pressable
          accessibilityLabel={retryLabel}
          accessibilityState={{ busy: pending, disabled: pending }}
          disabled={pending}
          onPress={onRetry}
          style={[styles.retry, pending && styles.retryPending]}
        >
          <Text style={styles.retryText}>{retryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TunnelLoading(props: TunnelLoadingProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <CloseButton onPress={props.onClose} />
      <View style={styles.center}>
        <ShimmerText text="Opening bounded tunnel…" />
      </View>
    </View>
  );
}

function CloseButton(props: CloseButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel="Close browser"
      accessibilityState={{ busy: props.disabled === true, disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={styles.close}
    >
      <Ionicons color={colors.text} name="close" size={23} />
    </Pressable>
  );
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.lg,
  },
  close: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  error: { color: colors.red, textAlign: "center", ...typeScale.body },
  retry: { justifyContent: "center", minHeight: touchTarget, paddingHorizontal: spacing.md },
  retryPending: { opacity: 0 },
  retryText: { color: colors.accent, ...typeScale.body },
  root: { backgroundColor: colors.background, flex: 1 },
});
