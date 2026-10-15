import { useState, type ReactElement, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { BackgroundTaskOutputPage } from "../../../data/backgroundTaskOutput";
import { useEvent } from "../../../react/useEvent";
import { AppSheet } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./BackgroundTaskOutputHost.styles";
import { BackgroundTaskContext, type OpenableBackgroundTask } from "./turnContexts";

type ReadPage = (taskId: string, offset: number) => Promise<BackgroundTaskOutputPage>;

/** The open dialog: the task, the pages read so far, and a page being read. */
type OpenTask = {
  readonly error: string | null;
  readonly loading: boolean;
  readonly pages: readonly BackgroundTaskOutputPage[];
  readonly task: OpenableBackgroundTask;
};

const STATUS_LABEL: Record<BackgroundTaskOutputPage["status"], string> = {
  completed: "Finished",
  failed: "Failed",
  killed: "Stopped",
  lost: "Lost on restart",
  running: "Running",
  stopped: "Stopped",
  unknown: "Status unknown",
};

/**
 * Owns the background task output dialog of one conversation: a task opens
 * by id, its first page loads before the dialog shows, and later pages load on
 * request. A running task shows its output so far and can be read again.
 */
export function BackgroundTaskOutputHost({
  children,
  read,
}: {
  readonly children: ReactNode;
  readonly read: ReadPage | undefined;
}): ReactElement {
  const [open, setOpen] = useState<OpenTask | null>(null);
  const openTask = useEvent(async (task: OpenableBackgroundTask): Promise<void> => {
    if (read === undefined) {
      return;
    }
    const first = await read(task.taskId, 0);
    setOpen({ error: null, loading: false, pages: [first], task });
  });
  const close = useEvent(() => {
    setOpen(null);
  });
  const readNext = useEvent(() => {
    const current = open;
    const last = current?.pages.at(-1);
    if (read === undefined || current === null || last === undefined) {
      return;
    }
    // A finished page ends at `sizeBytes`; a running task's output grows past it.
    const offset = last.nextOffset ?? last.sizeBytes;
    setOpen({ ...current, error: null, loading: true });
    read(current.task.taskId, offset).then(
      (page) => {
        setOpen({
          error: null,
          loading: false,
          pages: [...current.pages, page],
          task: current.task,
        });
      },
      (error: unknown) => {
        setOpen({
          ...current,
          error: error instanceof Error ? error.message : "Could not read the output",
          loading: false,
        });
      },
    );
  });
  return (
    <BackgroundTaskContext.Provider value={read === undefined ? null : openTask}>
      {children}
      <AppSheet
        contentProps={{
          contentContainerClassName: "h-full",
          dismissLabel: "Close task output",
          enableDynamicSizing: false,
          enableOverDrag: false,
          index: 0,
          snapPoints: ["70%", "90%"],
        }}
        isOpen={open !== null}
        onOpenChange={(next) => {
          if (!next) {
            close();
          }
        }}
      >
        {open === null ? null : <TaskOutput open={open} readNext={readNext} />}
      </AppSheet>
    </BackgroundTaskContext.Provider>
  );
}

function TaskOutput({
  open,
  readNext,
}: {
  readonly open: OpenTask;
  readonly readNext: () => void;
}): ReactElement {
  const last = open.pages.at(-1);
  const status = last?.status ?? "unknown";
  const text = open.pages.map((page) => page.text).join("");
  return (
    <View style={styles.body}>
      <View style={styles.header}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {open.task.name}
        </Text>
        <Text shimmering={status === "running"} style={styles.status}>
          {STATUS_LABEL[status]}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} testID="background-task-output">
        <Text selectable style={styles.output}>
          {text === "" ? "No output yet." : text}
        </Text>
        {open.error === null ? null : <Text style={styles.error}>{open.error}</Text>}
        <TaskOutputActions last={last} loading={open.loading} readNext={readNext} />
      </ScrollView>
    </View>
  );
}

function TaskOutputActions({
  last,
  loading,
  readNext,
}: {
  readonly last: BackgroundTaskOutputPage | undefined;
  readonly loading: boolean;
  readonly readNext: () => void;
}): ReactElement | null {
  const more = last?.nextOffset !== null && last !== undefined;
  const running = last?.status === "running";
  if (!more && !running) {
    return null;
  }
  const label = more ? "Load more" : "Read new output";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      onPress={readNext}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      testID="background-task-output-more"
    >
      <Text shimmering={loading} style={styles.actionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}
