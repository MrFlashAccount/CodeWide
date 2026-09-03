import { TerminalView, type TerminalViewRef } from "expo-libghostty";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../../../../react/useEvent";
import type {
  TerminalController,
  TerminalOutputEvent,
} from "../../../application/terminalController";
import type { TerminalSession } from "../../../domain/terminalSession";
import { colors, spacing, typeScale } from "../../../theme";
import { ShimmerText } from "../../../presentation/text/ShimmerText";
import { ProductText as Text } from "../../../presentation/text/ProductText";
import { terminalWriteFailure, TerminalWriteQueue } from "./terminalWriteQueue";

const TERMINAL_FONT_SIZE = 10;

interface TerminalRendererViewProps {
  controller: TerminalController;
  session: TerminalSession;
}

interface TerminalInputEvent {
  nativeEvent: { data: string };
}

interface TerminalResizeEvent {
  nativeEvent: { cols: number; rows: number };
}

/** Builds one disposable Ghostty VT from Companion replay and forwards live terminal I/O. */
export function TerminalRendererView(props: TerminalRendererViewProps): React.JSX.Element {
  const { controller, session } = props;
  const terminal = useRef<TerminalViewRef>(null);
  const active = useRef(true);
  const [writeQueue] = useState(() => new TerminalWriteQueue());
  const [renderError, setRenderError] = useState<string | null>(null);
  const { height, width } = useWindowDimensions();

  const receive = useEvent((event: TerminalOutputEvent): Promise<void> => {
    return writeQueue
      .run(() => {
        const mounted = terminal.current;
        if (!active.current || mounted === null)
          return terminalWriteFailure("Terminal renderer is unavailable");
        return mounted.write(event.data).then(() => {
          if (!active.current)
            return terminalWriteFailure("Terminal renderer was detached during output");
          setRenderError(null);
          return undefined;
        });
      })
      .catch((cause: unknown) => {
        const failure = message(cause, "Could not restore terminal output");
        if (active.current) setRenderError(failure);
        return terminalWriteFailure(failure);
      });
  });
  const send = useEvent((event: TerminalInputEvent): void => {
    void controller.input(session.id, event.nativeEvent.data).catch((cause: unknown) => {
      setRenderError(message(cause, "Could not send terminal input"));
    });
  });
  const resize = useEvent((event: TerminalResizeEvent): void => {
    void controller
      .resize(session.id, event.nativeEvent.cols, event.nativeEvent.rows)
      .catch((cause: unknown) => {
        if (session.status !== "closed" && session.status !== "failed")
          setRenderError(message(cause, "Could not resize terminal"));
      });
  });
  const reconcile = useEvent((): void => {
    void terminal.current?.reconcileLayout?.().catch((cause: unknown) => {
      setRenderError(message(cause, "Could not restore terminal layout"));
    });
  });

  useEffect(() => {
    active.current = true;
    const unsubscribe = controller.subscribeOutput(session.id, receive);
    const detach = controller.attachRenderer(session.id);
    return () => {
      active.current = false;
      unsubscribe();
      detach();
    };
  }, [controller, receive, session.id]);

  useEffect(() => {
    if (session.status !== "closed") return;
    void terminal.current?.finish(session.exitCode ?? 0).catch(() => undefined);
  }, [session.exitCode, session.status]);

  useEffect(() => {
    const frame = requestAnimationFrame(reconcile);
    return () => cancelAnimationFrame(frame);
  }, [height, reconcile, session.id, width]);

  const error = renderError ?? (session.errorCode === "replayUnavailable" ? null : session.error);
  return (
    <View onLayout={reconcile} style={styles.pane}>
      {error === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      )}
      <TerminalView
        ref={terminal}
        fontSize={TERMINAL_FONT_SIZE}
        onInput={send}
        onResize={resize}
        style={styles.terminal}
        theme={{
          background: colors.background,
          cursorColor: colors.text,
          foreground: colors.text,
          selectionBackground: colors.surfaceHover,
        }}
      />
      {session.status === "connecting" ? (
        <View pointerEvents="none" style={styles.connecting}>
          <ShimmerText style={styles.loadingText} text="Connecting…" />
        </View>
      ) : null}
    </View>
  );
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  connecting: { position: "absolute", right: spacing.md, top: spacing.md },
  errorBanner: {
    backgroundColor: colors.errorContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  errorText: { color: colors.red, ...typeScale.label },
  loadingText: { color: colors.textMuted, ...typeScale.caption },
  pane: { flex: 1, minHeight: 0, minWidth: 0 },
  terminal: { backgroundColor: colors.background, flex: 1, minHeight: 0, minWidth: 0 },
});
