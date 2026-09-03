import { Ionicons } from "@expo/vector-icons";
import type { V2BackgroundProcess } from "@codewide/sync-client/v2";
import { useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText as Text } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface BackgroundProcessesViewProps {
  error: string | null;
  items: readonly V2BackgroundProcess[];
  onClose(): void;
  onRefresh(): void | Promise<void>;
  onTerminate(processId: string): Promise<void>;
  status: "error" | "loading" | "ready";
}

interface ProcessRowProps {
  item: V2BackgroundProcess;
  onTerminate(processId: string): Promise<void>;
}

export function BackgroundProcessesView(props: BackgroundProcessesViewProps): React.JSX.Element {
  const refresh = useEvent(() => void Promise.resolve(props.onRefresh()).catch(() => undefined));
  return (
    <View accessibilityLabel="Background processes" style={styles.root}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Background processes</Text>
        <Pressable
          accessibilityLabel="Refresh background processes"
          accessibilityRole="button"
          onPress={refresh}
          style={styles.headerButton}
        >
          <Ionicons color={colors.text} name="refresh" size={19} />
        </Pressable>
        <Pressable
          accessibilityLabel="Close background processes"
          accessibilityRole="button"
          onPress={props.onClose}
          style={styles.headerButton}
        >
          <Ionicons color={colors.text} name="close" size={20} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {props.status === "loading" && props.items.length === 0 ? (
          <ShimmerText style={styles.loading} text="Reading background processes…" />
        ) : null}
        {props.error === null ? null : (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {props.error}
          </Text>
        )}
        {props.status !== "loading" && props.items.length === 0 ? (
          <Text style={styles.empty}>No background commands are running.</Text>
        ) : (
          props.items.map((item) => (
            <ProcessRow item={item} key={item.itemId} onTerminate={props.onTerminate} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ProcessRow(props: ProcessRowProps): React.JSX.Element {
  const [pending, startAction] = useTransition();
  const terminate = useEvent((): void => {
    if (pending) return;
    startAction(async () => props.onTerminate(props.item.processId));
  });
  return (
    <View style={styles.row}>
      <Ionicons color={colors.green} name="terminal-outline" size={18} />
      <View style={styles.rowBody}>
        <Text numberOfLines={2} selectable style={styles.command}>
          {props.item.command}
        </Text>
        <Text numberOfLines={1} selectable style={styles.cwd}>
          {props.item.cwd}
        </Text>
        <Text style={styles.meta}>{processMetadata(props.item)}</Text>
      </View>
      <Pressable
        accessibilityLabel={`Terminate ${props.item.command}`}
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        onPress={terminate}
        style={styles.terminate}
      >
        {pending ? (
          <ShimmerText style={styles.terminateText} text="Stopping" widthPolicy="intrinsic" />
        ) : (
          <>
            <Ionicons color={colors.red} name="stop-circle-outline" size={18} />
            <Text style={styles.terminateText}>Terminate</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function processMetadata(process: V2BackgroundProcess): string {
  const parts: string[] = [];
  if (process.osPid !== null) parts.push(`PID ${process.osPid}`);
  if (process.cpuPercent !== null) parts.push(`CPU ${process.cpuPercent.toFixed(1)}%`);
  if (process.rssKiB !== null) parts.push(`RAM ${formatKiB(process.rssKiB)}`);
  return parts.length === 0 ? "Metrics unavailable" : parts.join(" · ");
}

function formatKiB(value: string): string {
  const kibibytes = BigInt(value);
  const mebibyte = 1024n;
  const gibibyte = mebibyte * 1024n;
  if (kibibytes >= gibibyte) return `${formatDecimal(kibibytes, gibibyte)} GiB`;
  if (kibibytes >= mebibyte) return `${formatDecimal(kibibytes, mebibyte)} MiB`;
  return `${kibibytes.toString()} KiB`;
}

function formatDecimal(value: bigint, unit: bigint): string {
  const tenths = (value * 10n) / unit;
  return `${tenths / 10n}.${tenths % 10n}`;
}

const styles = StyleSheet.create({
  command: { color: colors.text, ...typeScale.label },
  cwd: { color: colors.textMuted, ...typeScale.caption },
  empty: { color: colors.textMuted, padding: spacing.md, ...typeScale.body },
  error: { color: colors.red, paddingHorizontal: spacing.md, ...typeScale.label },
  headerButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  list: { gap: spacing.xs, padding: spacing.sm },
  loading: { color: colors.textMuted, margin: spacing.md, ...typeScale.body },
  meta: { color: colors.textDim, ...typeScale.caption },
  root: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    maxHeight: 360,
  },
  row: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    padding: spacing.sm,
  },
  rowBody: { flex: 1, gap: spacing.optical, minWidth: 0 },
  terminate: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  terminateText: { color: colors.red, ...typeScale.label },
  title: { color: colors.text, flex: 1, ...typeScale.title },
  titleRow: { alignItems: "center", flexDirection: "row", paddingLeft: spacing.md },
});
