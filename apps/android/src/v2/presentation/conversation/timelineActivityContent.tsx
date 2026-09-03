import { Pressable, StyleSheet, View } from "react-native";
import { useState } from "react";

import { useEvent } from "../../../react/useEvent";
import { CodeBlock } from "../../rendering/CodeBlock";
import { privateImageReference } from "../../rendering/privateImageReference";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import { colors, radii, spacing } from "../../theme";
import { ProductText } from "../text/ProductText";
import { timelineActivityJson, type TimelineActivityJson } from "./timelineActivityJson";
import type { TimelineActivityActions, TimelineDisplayActivity } from "./timelineTypes";

interface TimelineActivityContentProps {
  actions?: TimelineActivityActions;
  activity: TimelineDisplayActivity;
  turnId: string;
}

interface ActivityActionProps {
  accessibilityLabel: string;
  label: string;
  onPress(): Promise<void> | void;
}

interface CommandActivityProps {
  actions?: TimelineActivityActions;
  activity: Extract<TimelineDisplayActivity, { kind: "command" }>;
  turnId: string;
}

interface FileChangeActivityProps {
  activity: Extract<TimelineDisplayActivity, { kind: "fileChange" }>;
}

interface ToolActivityProps {
  actions?: TimelineActivityActions;
  activity: Extract<TimelineDisplayActivity, { kind: "tool" }>;
  turnId: string;
}

interface PlanActivityProps {
  activity: Extract<TimelineDisplayActivity, { kind: "plan" }>;
}

interface AttachmentActivityProps {
  actions?: TimelineActivityActions;
  activity: Extract<TimelineDisplayActivity, { kind: "attachment" }>;
}

interface CollaborationActivityProps {
  activity: Extract<TimelineDisplayActivity, { kind: "collaboration" }>;
}

interface SubagentActivityProps {
  actions?: TimelineActivityActions;
  activity: Extract<TimelineDisplayActivity, { kind: "subagentActivity" }>;
}

interface WebSearchActivityProps {
  activity: Extract<TimelineDisplayActivity, { kind: "webSearch" }>;
}

interface ImageGenerationActivityProps {
  activity: Extract<TimelineDisplayActivity, { kind: "imageGeneration" }>;
}

interface ImageViewActivityProps {
  activity: Extract<TimelineDisplayActivity, { kind: "imageView" }>;
}

interface UnsupportedActivityProps {
  actions?: TimelineActivityActions;
  activity: Extract<TimelineDisplayActivity, { kind: "unsupported" }>;
}

interface HistoricalImageProps {
  label: string;
  sourceUrl: string | null;
}

interface JsonSectionProps {
  label: string;
  showFullscreen?: boolean;
  value: TimelineActivityJson | null;
}

interface MarkdownSectionsProps {
  values: string[];
}

export function TimelineActivityContent(
  props: TimelineActivityContentProps,
): React.JSX.Element | null {
  const { actions, activity, turnId } = props;
  switch (activity.kind) {
    case "reasoning":
      return <MarkdownSections values={reasoningSections(activity)} />;
    case "command":
      return (
        <CommandActivity
          {...(actions === undefined ? {} : { actions })}
          activity={activity}
          turnId={turnId}
        />
      );
    case "fileChange":
      return <FileChangeActivity activity={activity} />;
    case "tool":
      return (
        <ToolActivity
          {...(actions === undefined ? {} : { actions })}
          activity={activity}
          turnId={turnId}
        />
      );
    case "plan":
      return <PlanActivity activity={activity} />;
    case "attachment":
      return (
        <AttachmentActivity {...(actions === undefined ? {} : { actions })} activity={activity} />
      );
    case "hookPrompt":
      return <MarkdownSections values={activity.fragments} />;
    case "collaboration":
      return <CollaborationActivity activity={activity} />;
    case "subagentActivity":
      return (
        <SubagentActivity {...(actions === undefined ? {} : { actions })} activity={activity} />
      );
    case "webSearch":
      return <WebSearchActivity activity={activity} />;
    case "imageView":
      return <ImageViewActivity activity={activity} />;
    case "sleep":
      return <ProductText tone="muted">{`${activity.durationMs.toLocaleString()} ms`}</ProductText>;
    case "imageGeneration":
      return <ImageGenerationActivity activity={activity} />;
    case "reviewMode":
      return (
        <MarkdownSections
          values={[activity.reviewState, ...(activity.review === null ? [] : [activity.review])]}
        />
      );
    case "contextCompaction":
      return <ProductText tone="muted">The conversation context was compacted.</ProductText>;
    case "unsupported":
      return (
        <UnsupportedActivity {...(actions === undefined ? {} : { actions })} activity={activity} />
      );
    default:
      return unreachableActivity(activity);
  }
}

function UnsupportedActivity(props: UnsupportedActivityProps): React.JSX.Element {
  const { actions, activity } = props;
  const copy = useEvent(async () => {
    await actions?.onCopyUnsupported?.(activity.payloadJson);
  });
  const fix = useEvent(async () => {
    await actions?.onFixUnsupported?.(activity.sourceKind, activity.payloadJson);
  });
  return (
    <View accessibilityLiveRegion="polite" style={styles.unsupported}>
      <ProductText tone="warning" weight="semibold">
        Unsupported activity · {activity.sourceKind}
      </ProductText>
      {activity.payloadTruncated ? (
        <ProductText tone="muted">Sensitive or oversized fields were removed.</ProductText>
      ) : null}
      <CodeBlock language="json" showFullscreen={false} value={activity.payloadJson} />
      <View style={styles.unsupportedActions}>
        {actions?.onCopyUnsupported === undefined ? null : (
          <ActivityAction accessibilityLabel="Copy unsupported item" label="Copy" onPress={copy} />
        )}
        {actions?.onFixUnsupported === undefined ? null : (
          <ActivityAction
            accessibilityLabel="Fix unsupported item in new thread"
            label="Fix in new thread"
            onPress={fix}
          />
        )}
      </View>
    </View>
  );
}

function CommandActivity(props: CommandActivityProps): React.JSX.Element {
  const { actions, activity, turnId } = props;
  const openOutput = useEvent(async () => {
    await actions?.onOpenItemOutput?.(turnId, activity.id);
  });
  const metadata = [activity.cwd];
  if (activity.exitCode !== null) metadata.push(`exit ${String(activity.exitCode)}`);
  if (activity.durationMs !== null) metadata.push(`${String(activity.durationMs)} ms`);
  return (
    <View style={styles.sections}>
      <ProductText selectable tone="dim">
        {metadata.join(" · ")}
      </ProductText>
      <CodeBlock language="shell" value={activity.command} />
      {activity.output === "" ? null : (
        <CodeBlock language="text" showFullscreen={false} value={activity.output} />
      )}
      {actions?.onOpenItemOutput === undefined ? null : (
        <ActivityAction
          accessibilityLabel={`Open full output for ${activity.label}`}
          label="Full output"
          onPress={openOutput}
        />
      )}
    </View>
  );
}

function FileChangeActivity(props: FileChangeActivityProps): React.JSX.Element {
  const { activity } = props;
  const changes =
    activity.changes.length === 0
      ? [{ change: activity.change, path: activity.path }]
      : activity.changes;
  return (
    <View style={styles.sections}>
      {changes.map((change) => (
        <View key={`${change.path}:${change.change}`} style={styles.sections}>
          <ProductText selectable tone="muted" weight="semibold">
            {`${change.change} · ${change.path}`}
          </ProductText>
          {change.diff === undefined || change.diff === "" ? null : (
            <CodeBlock language="diff" value={change.diff} />
          )}
        </View>
      ))}
    </View>
  );
}

function ToolActivity(props: ToolActivityProps): React.JSX.Element {
  const { actions, activity, turnId } = props;
  const openOutput = useEvent(async () => {
    await actions?.onOpenItemOutput?.(turnId, activity.id);
  });
  const argumentsValue = timelineActivityJson(activity.argumentsJson);
  const result = timelineActivityJson(activity.resultJson);
  const appContext = timelineActivityJson(
    activity.appContext === null ? null : JSON.stringify(activity.appContext),
  );
  const metadata = [
    activity.server,
    activity.pluginId === null ? null : `plugin ${activity.pluginId}`,
    activity.readOnlyHint === null ? null : `read-only hint: ${String(activity.readOnlyHint)}`,
    activity.success === null ? null : `success: ${String(activity.success)}`,
    durationLabel(activity.durationMs),
  ].filter((value): value is string => value !== null);
  return (
    <View style={styles.sections}>
      {metadata.length === 0 ? null : <ProductText tone="dim">{metadata.join(" · ")}</ProductText>}
      {activity.summary === "" ? null : <RichMarkdown source={activity.summary} />}
      <JsonSection label="App context" value={appContext} />
      <JsonSection label="Arguments" value={argumentsValue} />
      <JsonSection label="Result" showFullscreen={false} value={result} />
      {actions?.onOpenItemOutput === undefined ? null : (
        <ActivityAction
          accessibilityLabel={`Open full output for ${activity.label}`}
          label="Full output"
          onPress={openOutput}
        />
      )}
      {activity.error === null ? null : (
        <ProductText selectable tone="danger">
          {activity.error}
        </ProductText>
      )}
    </View>
  );
}

function PlanActivity(props: PlanActivityProps): React.JSX.Element {
  const { activity } = props;
  const steps = activity.steps
    .map((step) => `${step.status === "completed" ? "- [x]" : "- [ ]"} ${step.text}`)
    .join("\n");
  return <MarkdownSections values={[...(activity.text === null ? [] : [activity.text]), steps]} />;
}

function AttachmentActivity(props: AttachmentActivityProps): React.JSX.Element {
  const { actions, activity } = props;
  const { attachment } = activity;
  const open = actions?.onOpenAttachment;
  const activate = useEvent(async () => {
    await open?.(attachment);
  });
  const image = attachment.mediaType.toLowerCase().startsWith("image/");
  const source = attachment.downloadUrl;
  return (
    <View style={styles.sections}>
      {image && source !== null ? (
        <RichMarkdown source={`![${escapeMarkdown(attachment.name)}](${source})`} />
      ) : null}
      <ActivityAction
        accessibilityLabel={`Open attachment ${attachment.name}`}
        label={`${attachment.name} · ${attachment.mediaType} · ${formatBytes(attachment.sizeBytes)}`}
        onPress={activate}
      />
    </View>
  );
}

function CollaborationActivity(props: CollaborationActivityProps): React.JSX.Element {
  const { activity } = props;
  const metadata = [activity.model, activity.effort].filter(
    (value): value is string => value !== null,
  );
  const agents = timelineActivityJson(activity.agentsStatesJson);
  const receiverLabel = activity.receiverThreadIds.join(", ");
  return (
    <View style={styles.sections}>
      {metadata.length === 0 ? null : <ProductText tone="dim">{metadata.join(" · ")}</ProductText>}
      {activity.prompt === null ? null : <RichMarkdown source={activity.prompt} />}
      <ProductText selectable tone="muted">
        {`From: ${activity.senderThreadId ?? "current thread"}\nTo: ${receiverLabel === "" ? "none" : receiverLabel}`}
      </ProductText>
      <JsonSection label="Agents" value={agents} />
    </View>
  );
}

function SubagentActivity(props: SubagentActivityProps): React.JSX.Element {
  const { actions, activity } = props;
  const open = actions?.onOpenSubagent;
  const activate = useEvent(async () => {
    await open?.(activity.agentThreadId);
  });
  return (
    <View style={styles.sections}>
      <ProductText selectable tone="muted">
        {[activity.activityKind, ...activity.agentPath].join(" · ")}
      </ProductText>
      <ActivityAction
        accessibilityLabel="Open subagent conversation"
        label="Open subagent"
        onPress={activate}
      />
    </View>
  );
}

function WebSearchActivity(props: WebSearchActivityProps): React.JSX.Element {
  const { activity } = props;
  return (
    <View style={styles.sections}>
      <RichMarkdown source={`**Query:** ${escapeMarkdown(activity.query)}`} />
      <JsonSection label="Action" value={timelineActivityJson(activity.actionJson)} />
      <JsonSection label="Results" value={timelineActivityJson(activity.resultsJson)} />
    </View>
  );
}

function ImageGenerationActivity(props: ImageGenerationActivityProps): React.JSX.Element {
  const { activity } = props;
  return (
    <View style={styles.sections}>
      <HistoricalImage label="Generated image" sourceUrl={activity.sourceUrl} />
      {activity.prompt === "" ? null : <RichMarkdown source={activity.prompt} />}
      {activity.savedPath === null ? null : (
        <ProductText numberOfLines={1} selectable tone="dim">
          {activity.savedPath}
        </ProductText>
      )}
    </View>
  );
}

function ImageViewActivity(props: ImageViewActivityProps): React.JSX.Element {
  const { activity } = props;
  return (
    <View style={styles.sections}>
      <HistoricalImage label="Viewed image" sourceUrl={activity.sourceUrl} />
      <ProductText numberOfLines={1} selectable tone="dim">
        {activity.path}
      </ProductText>
    </View>
  );
}

function HistoricalImage(props: HistoricalImageProps): React.JSX.Element {
  const { label, sourceUrl } = props;
  if (sourceUrl === null) {
    return <ProductText tone="muted">No authenticated image preview is available.</ProductText>;
  }
  return (
    <RichMarkdown source={`![${escapeMarkdown(label)}](${privateImageReference(sourceUrl)})`} />
  );
}

function JsonSection(props: JsonSectionProps): React.JSX.Element | null {
  const { label, showFullscreen = true, value } = props;
  if (value === null) return null;
  return (
    <View style={styles.sections}>
      <ProductText tone="muted" weight="semibold">
        {label}
      </ProductText>
      {value.resources.map((resource) => (
        <RichMarkdown
          key={`${resource.kind}:${resource.value}`}
          source={resourceMarkdown(resource)}
        />
      ))}
      <CodeBlock language="json" showFullscreen={showFullscreen} value={value.display} />
    </View>
  );
}

function MarkdownSections(props: MarkdownSectionsProps): React.JSX.Element | null {
  const { values } = props;
  const visible = values.filter((value) => value.trim() !== "");
  if (visible.length === 0) return null;
  return (
    <View style={styles.sections}>
      {markdownEntries(visible).map((entry) => (
        <RichMarkdown key={entry.id} source={entry.value} />
      ))}
    </View>
  );
}

function ActivityAction(props: ActivityActionProps): React.JSX.Element {
  const { accessibilityLabel, label, onPress } = props;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activate = useEvent(() => {
    if (pending) return;
    setPending(true);
    setError(null);
    Promise.resolve(onPress())
      .catch(() => setError("Action failed. Try again."))
      .finally(() => setPending(false));
  });
  return (
    <View style={styles.actionGroup}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        onPress={activate}
        style={styles.action}
      >
        <ProductText tone="muted" weight="semibold">
          {pending ? "Opening…" : label}
        </ProductText>
      </Pressable>
      {error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" tone="danger">
          {error}
        </ProductText>
      )}
    </View>
  );
}

interface MarkdownEntry {
  id: string;
  value: string;
}

function markdownEntries(values: string[]): MarkdownEntry[] {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const occurrence = counts.get(value) ?? 0;
    counts.set(value, occurrence + 1);
    return { id: `${value}:${String(occurrence)}`, value };
  });
}

function reasoningSections(
  activity: Extract<TimelineDisplayActivity, { kind: "reasoning" }>,
): string[] {
  if (activity.contentParts.length > 0) return activity.contentParts;
  if (activity.summaryParts.length > 0) return activity.summaryParts;
  return activity.summary === "" ? [] : [activity.summary];
}

function resourceMarkdown(resource: TimelineActivityJson["resources"][number]): string {
  const label = escapeMarkdown(resource.label);
  if (resource.kind === "image") return `![${label}](${resource.value})`;
  if (resource.kind === "text") return resource.value;
  return `[${resource.kind === "audio" ? `Audio · ${label}` : label}](${resource.value})`;
}

function durationLabel(durationMs: number | null): string | null {
  return durationMs === null ? null : `${String(durationMs)} ms`;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/[\\[\]*_`]/gu, String.raw`\$&`);
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return `${value} B`;
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function unreachableActivity(_activity: never): null {
  return null;
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  actionGroup: { alignItems: "flex-start", gap: spacing.xxs },
  sections: { gap: spacing.xs, minWidth: 0, width: "100%" },
  unsupported: {
    backgroundColor: colors.warningContainer,
    borderRadius: radii.small,
    gap: spacing.xxs,
    padding: spacing.xs,
  },
  unsupportedActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
});
