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
import { useConstant } from "../../react/useConstant";
import { colors, iconSize } from "../../theme";
import { useFullscreenWindowReady } from "../../ui/FullscreenWindowReady";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./TerminalWorkspace.styles";

export function TerminalTab({ tab }: { tab: InteractiveTerminalTab }) {
  const terminalRef = useRef<TerminalViewRef>(null);
  const fullscreenWindowReady = useFullscreenWindowReady();
  const initialOffset = useConstant(() => readInteractiveTerminalRenderedOffset(tab.id));
  const nextOffsetRef = useRef(initialOffset);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pumping = false;
    let requested = false;
    let finished = false;
    const isDisposed = (): boolean => disposed;

    const drain = async () => {
      while (requested && !disposed) {
        requested = false;
        const terminal = terminalRef.current;
        if (terminal === null) {
          return;
        }
        while (!isDisposed()) {
          const chunk = await readNativeTerminalOutput(tab.id, nextOffsetRef.current);
          if (chunk.data !== "") {
            await terminal.write(chunk.data);
          }
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
      if (pumping || disposed) {
        return;
      }
      pumping = true;
      void drain().then(
        () => {
          pumping = false;
          if (requested && !disposed) {
            pump();
          }
        },
        (error: unknown) => {
          pumping = false;
          if (!disposed) {
            setRenderError(message(error, "Could not restore terminal output"));
          }
          if (requested && !disposed) {
            pump();
          }
        },
      );
    };

    const unsubscribe = subscribeNativeTerminal((event) => {
      if (event.sessionId !== tab.id) {
        return;
      }
      if (
        event.type === "output" ||
        event.type === "open" ||
        event.type === "closed" ||
        event.type === "error"
      ) {
        pump();
      }
    });
    pump();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [tab.id]);

  useEffect(() => {
    if (!fullscreenWindowReady) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      void terminalRef.current?.reconcileLayout?.().catch((error: unknown) => {
        setRenderError(message(error, "Could not restore terminal layout"));
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [fullscreenWindowReady, tab.id]);

  const resize = (cols: number, rows: number) => {
    void resizeNativeTerminal(tab.id, cols, rows).catch((error: unknown) => {
      if (tab.status !== "closed" && tab.status !== "error") {
        setRenderError(message(error, "Could not resize terminal"));
      }
    });
  };
  const send = (data: string) => {
    void writeNativeTerminal(tab.id, data).catch((error: unknown) => {
      setRenderError(message(error, "Could not send terminal input"));
    });
  };
  const error = renderError ?? tab.error;

  return (
    <View style={styles.terminalPane}>
      {error !== null && (
        <View style={styles.errorBanner}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={iconSize.inline} />
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      )}
      <TerminalView
        fontSize={TERMINAL_FONT_SIZE}
        onInput={({ nativeEvent }) => {
          send(nativeEvent.data);
        }}
        onResize={({ nativeEvent }) => {
          resize(nativeEvent.cols, nativeEvent.rows);
        }}
        persistentSessionId={tab.id}
        ref={terminalRef}
        style={styles.terminal}
        theme={{
          background: colors.background,
          cursorColor: colors.text,
          foreground: colors.text,
          selectionBackground: colors.surfaceHover,
        }}
      />
      {tab.status === "connecting" && (
        <View pointerEvents="none" style={styles.connecting}>
          <ActivityIndicator color={colors.textMuted} size="small" />
        </View>
      )}
    </View>
  );
}

export const TERMINAL_FONT_SIZE = 10;

export function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}
