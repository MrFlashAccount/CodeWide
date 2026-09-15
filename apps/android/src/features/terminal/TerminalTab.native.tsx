import { Ionicons } from "@expo/vector-icons";
import { TerminalView, type TerminalViewRef } from "expo-libghostty";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  commitInteractiveTerminalRenderedOffset,
  readInteractiveTerminalRenderedOffset,
  type InteractiveTerminalTab,
} from "../../data/interactive-terminal-store";
import {
  readNativeTerminalOutput,
  resizeNativeTerminal,
  subscribeNativeTerminal,
  writeNativeTerminal,
} from "../../native/native-transport";
import { colors, iconSize } from "../../theme";
import { useFullscreenWindowReady } from "../../ui/FullscreenWindowReady";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./TerminalWorkspace.styles";
export function TerminalTab({ tab }: { tab: InteractiveTerminalTab }) {
  const terminalRef = useRef<TerminalViewRef>(null);
  const fullscreenWindowReady = useFullscreenWindowReady();
  const nextOffsetRef = useRef(readInteractiveTerminalRenderedOffset(tab.id));
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pumping = false;
    let requested = false;
    let finished = false;

    const drain = async () => {
      while (requested && !disposed) {
        requested = false;
        const terminal = terminalRef.current;
        if (terminal === null) return;
        while (!disposed) {
          const chunk = await readNativeTerminalOutput(tab.id, nextOffsetRef.current);
          if (chunk.data !== "") await terminal.write(chunk.data);
          nextOffsetRef.current = chunk.nextOffset;
          commitInteractiveTerminalRenderedOffset(tab.id, chunk.nextOffset);
          if (!chunk.hasMore) {
            if (chunk.finished && !finished) {
              finished = true;
              await terminal.finish(0);
            }
            break;
          }
        }
      }
    };

    const pump = () => {
      requested = true;
      if (pumping || disposed) return;
      pumping = true;
      void drain().then(
        () => {
          pumping = false;
          if (requested && !disposed) pump();
        },
        (cause: unknown) => {
          pumping = false;
          if (!disposed) setRenderError(message(cause, "Could not restore terminal output"));
          if (requested && !disposed) pump();
        },
      );
    };

    const unsubscribe = subscribeNativeTerminal((event) => {
      if (event.sessionId !== tab.id) return;
      if (
        event.type === "output" ||
        event.type === "open" ||
        event.type === "closed" ||
        event.type === "error"
      )
        pump();
    });
    pump();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [tab.id]);

  useEffect(() => {
    if (!fullscreenWindowReady) return;
    const frame = requestAnimationFrame(() => {
      void terminalRef.current?.reconcileLayout?.().catch((cause: unknown) => {
        setRenderError(message(cause, "Could not restore terminal layout"));
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [fullscreenWindowReady, tab.id]);

  const resize = (cols: number, rows: number) => {
    void resizeNativeTerminal(tab.id, cols, rows).catch((cause) => {
      if (tab.status !== "closed" && tab.status !== "error")
        setRenderError(message(cause, "Could not resize terminal"));
    });
  };
  const send = (data: string) => {
    void writeNativeTerminal(tab.id, data).catch((cause) =>
      setRenderError(message(cause, "Could not send terminal input")),
    );
  };
  const error = renderError ?? tab.error;

  return (
    <View style={styles.terminalPane}>
      {error !== null && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={iconSize.inline} color={colors.red} />
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      )}
      <TerminalView
        ref={terminalRef}
        persistentSessionId={tab.id}
        fontSize={TERMINAL_FONT_SIZE}
        theme={{
          background: colors.background,
          foreground: colors.text,
          cursorColor: colors.text,
          selectionBackground: colors.surfaceHover,
        }}
        onInput={({ nativeEvent }) => send(nativeEvent.data)}
        onResize={({ nativeEvent }) => resize(nativeEvent.cols, nativeEvent.rows)}
        style={styles.terminal}
      />
      {tab.status === "connecting" && (
        <View pointerEvents="none" style={styles.connecting}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

export const TERMINAL_FONT_SIZE = 10;

export function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}
