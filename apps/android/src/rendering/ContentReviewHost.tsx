import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ContentReviewKeyboardDock } from "./ContentReviewKeyboardDock";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../react/useEvent";
import type { VoiceTranscriptionEvent, VoiceTranscriptionOptions, VoiceTranscriptionSession } from "../data/voice-input-controller";
import type { WorkspaceResourceDatabase } from "../data/workspace-resource-database";
import type { VoiceInputController } from "../data/voice-input-controller";
import { colors, radii, spacing, typeScale, typeWeight, iconSize, controlSize } from "../theme";
import { useAppDialog } from "../ui/AppDialog";
import { useMicrophoneAccess } from "../ui/use-microphone-access";
import { useScopedVoiceInputResource } from "../ui/VoiceInputRuntime";
import { AppText as Text, AppTextInput as TextInput } from "../ui/Typography";
import {
  contentReviewTextHighlights,
  serializeContentReviewAttachment,
  type ContentReviewAnchor,
  type ContentReviewComment,
} from "./content-review";

type VoiceStarter = (
  listener: (event: VoiceTranscriptionEvent) => void,
  options?: VoiceTranscriptionOptions,
) => Promise<VoiceTranscriptionSession>;

export type ContentReviewRuntime = {
  attach(markdown: string): Promise<string | null>;
  attachmentId: string | null;
  thread: Thread | null;
  voiceScope: string;
  resources: WorkspaceResourceDatabase | null;
  voiceController: VoiceInputController | null;
  startVoice?: VoiceStarter;
};

type RuntimeStore = {
  getSnapshot(): ContentReviewRuntime | null;
  subscribe(listener: () => void): () => void;
};

type ActiveReview = {
  id: string;
  scope: string;
  anchor: ContentReviewAnchor;
};

type ContentReviewController = {
  active: ActiveReview | null;
  comments: readonly ContentReviewComment[];
  runtimeStore: RuntimeStore;
  begin(anchor: ContentReviewAnchor): Promise<boolean>;
  cancel(id: string): void;
  save(id: string, body: string): Promise<boolean>;
  registerRuntime(runtime: ContentReviewRuntime): () => void;
};

export type ContentReviewHighlight = { start: number; end: number };
export type ContentReviewPoint = {
  id: string;
  x: number;
  y: number;
  pending: boolean;
};

const EMPTY_CONTENT_REVIEW_COMMENTS: ContentReviewComment[] = [];
const ContentReviewContext = createContext<ContentReviewController | null>(null);

export function ContentReviewHost({ children }: { children: ReactNode }) {
  const commentsByScopeRef = useRef(new Map<string, ContentReviewComment[]>());
  const attachmentByScopeRef = useRef(new Map<string, string>());
  const activeScopeRef = useRef<string | null>(null);
  const activeRef = useRef<ActiveReview | null>(null);
  const activeResolveRef = useRef<((saved: boolean) => void) | null>(null);
  const runtimeRef = useRef<ContentReviewRuntime | null>(null);
  const runtimeSubscribersRef = useRef(new Set<() => void>());
  const [comments, setComments] = useState<ContentReviewComment[]>([]);
  const [active, setActive] = useState<ActiveReview | null>(null);

  const publishComments = (next: ContentReviewComment[], scope: string) => {
    if (next.length === 0) commentsByScopeRef.current.delete(scope);
    else commentsByScopeRef.current.set(scope, next);
    if (activeScopeRef.current === scope) setComments(next);
  };
  const settleActive = (saved: boolean) => {
    const resolve = activeResolveRef.current;
    activeResolveRef.current = null;
    activeRef.current = null;
    setActive(null);
    resolve?.(saved);
  };
  const runtimeStore: RuntimeStore = {
    getSnapshot: () => runtimeRef.current,
    subscribe(listener) {
      runtimeSubscribersRef.current.add(listener);
      return () => runtimeSubscribersRef.current.delete(listener);
    },
  };
  const notifyRuntime = () => {
    for (const listener of runtimeSubscribersRef.current) listener();
  };
  const createComment = (anchor: ContentReviewAnchor, body: string): ContentReviewComment => ({
    id: `content-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    anchor,
    body: body.trim(),
    createdAt: Date.now(),
  });

  const begin = (anchor: ContentReviewAnchor): Promise<boolean> => {
    const scope = runtimeRef.current?.voiceScope ?? activeScopeRef.current;
    if (scope === null) return Promise.resolve(false);
    settleActive(false);
    return new Promise((resolve) => {
      const next: ActiveReview = {
        id: `content-review-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        scope,
        anchor,
      };
      activeResolveRef.current = resolve;
      activeRef.current = next;
      setActive(next);
    });
  };
  const cancel = (id: string) => {
    if (activeRef.current?.id === id) settleActive(false);
  };
  const save = async (id: string, body: string): Promise<boolean> => {
    const current = activeRef.current;
    const runtime = runtimeRef.current;
    const trimmed = body.trim();
    if (current === null || current.id !== id || trimmed === "" || runtime === null || runtime.voiceScope !== current.scope) return false;
    const next = [...(commentsByScopeRef.current.get(current.scope) ?? []), createComment(current.anchor, trimmed)];
    const markdown = serializeContentReviewAttachment(next);
    if (markdown === "") return false;
    const attachmentId = await runtime.attach(markdown);
    if (attachmentId === null) return false;
    attachmentByScopeRef.current.set(current.scope, attachmentId);
    publishComments(next, current.scope);
    if (activeRef.current?.id === id) settleActive(true);
    return true;
  };
  const registerRuntime = (runtime: ContentReviewRuntime): (() => void) => {
    const previousScope = activeScopeRef.current;
    if (previousScope !== null && previousScope !== runtime.voiceScope && activeRef.current?.scope === previousScope) settleActive(false);
    activeScopeRef.current = runtime.voiceScope;
    runtimeRef.current = runtime;
    const knownAttachment = attachmentByScopeRef.current.get(runtime.voiceScope) ?? null;
    if (knownAttachment !== null && runtime.attachmentId === null) {
      attachmentByScopeRef.current.delete(runtime.voiceScope);
      publishComments([], runtime.voiceScope);
      if (activeRef.current?.scope === runtime.voiceScope) settleActive(false);
    } else if (runtime.attachmentId !== null) {
      attachmentByScopeRef.current.set(runtime.voiceScope, runtime.attachmentId);
    }
    setComments(commentsByScopeRef.current.get(runtime.voiceScope) ?? EMPTY_CONTENT_REVIEW_COMMENTS);
    notifyRuntime();
    return () => {
      if (runtimeRef.current !== runtime) return;
      runtimeRef.current = null;
      notifyRuntime();
    };
  };

  const [actions] = useState(() => ({
    runtimeStore,
    begin,
    cancel,
    save,
    registerRuntime,
  }));
  const controller: ContentReviewController = {
    ...actions,
    active,
    comments,
  };

  return (
    <ContentReviewContext.Provider value={controller}>
      <View style={styles.host}>{children}</View>
    </ContentReviewContext.Provider>
  );
}

export function useContentReview(): (anchor: ContentReviewAnchor) => Promise<boolean> {
  const controller = useContext(ContentReviewContext);
  return useEvent(async (anchor: ContentReviewAnchor) => await controller?.begin(anchor) ?? false);
}

export function useContentReviewHighlights(
  targetId: string,
  blockPath: string,
  offset = 0,
): readonly ContentReviewHighlight[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) return [];
  const anchors = [
    ...controller.comments.map((comment) => comment.anchor),
    ...(controller.active === null ? [] : [controller.active.anchor]),
  ];
  return contentReviewTextHighlights(anchors, targetId, blockPath, offset);
}

export function useContentReviewComments(
  targetId: string,
  diagramId?: string,
): readonly ContentReviewComment[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) return EMPTY_CONTENT_REVIEW_COMMENTS;
  return controller.comments.filter((comment) => {
    if (comment.anchor.target.id !== targetId) return false;
    if (diagramId === undefined) return true;
    return comment.anchor.kind === "mermaid" && comment.anchor.diagramId === diagramId;
  });
}

export function useContentReviewPoints(targetId: string, diagramId: string): readonly ContentReviewPoint[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) return [];
  const saved = controller.comments.flatMap((comment) => {
    const anchor = comment.anchor;
    return anchor.kind === "mermaid" && anchor.target.id === targetId && anchor.diagramId === diagramId
      ? [{ id: comment.id, x: anchor.x, y: anchor.y, pending: false }]
      : [];
  });
  const activeAnchor = controller.active?.anchor;
  if (activeAnchor?.kind !== "mermaid" || activeAnchor.target.id !== targetId || activeAnchor.diagramId !== diagramId) return saved;
  return [...saved, { id: controller.active?.id ?? "pending", x: activeAnchor.x, y: activeAnchor.y, pending: true }];
}

export function useContentReviewRuntime(runtime: ContentReviewRuntime): void {
  const controller = useContext(ContentReviewContext);
  const registerRuntime = controller?.registerRuntime;
  const attach = useEvent(runtime.attach);
  const { attachmentId, thread, voiceScope, resources, voiceController, startVoice: startVoiceInput } = runtime;
  useEffect(() => {
    if (registerRuntime === undefined) return;
    return registerRuntime({
      attach: (markdown) => attach(markdown),
      attachmentId,
      thread,
      voiceScope,
      resources,
      voiceController,
      // A recording retains its originating server/thread while native capture
      // starts. A latest-render callback could connect it to another chat.
      ...(startVoiceInput === undefined ? {} : { startVoice: startVoiceInput }),
    });
  }, [attach, attachmentId, registerRuntime, startVoiceInput, thread, voiceController, resources, voiceScope]);
}

export function useImageReviewPoints(targetId: string): readonly ContentReviewPoint[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) return [];
  const points: ContentReviewPoint[] = [];
  for (const comment of controller.comments) {
    const anchor = comment.anchor;
    if (anchor.kind === "image" && anchor.target.id === targetId) {
      points.push({ id: comment.id, x: anchor.x, y: anchor.y, pending: false });
    }
  }
  const active = controller.active;
  if (active?.anchor.kind === "image" && active.anchor.target.id === targetId) {
    points.push({ id: active.id, x: active.anchor.x, y: active.anchor.y, pending: true });
  }
  return points;
}

export function ContentReviewComposer({
  targetId,
  targetPrefix,
  anchorKind,
  diagramId,
}: {
  targetId?: string;
  targetPrefix?: string;
  anchorKind?: ContentReviewAnchor["kind"];
  diagramId?: string;
}) {
  const controller = useContext(ContentReviewContext);
  const active = controller?.active ?? null;
  if (controller === null || active === null) return null;
  if (targetId !== undefined && active.anchor.target.id !== targetId) return null;
  if (targetPrefix !== undefined && !active.anchor.target.id.startsWith(targetPrefix)) return null;
  if (anchorKind !== undefined && active.anchor.kind !== anchorKind) return null;
  if (diagramId !== undefined && (active.anchor.kind !== "mermaid" || active.anchor.diagramId !== diagramId)) return null;
  return <InlineContentReviewComposer key={active.id} active={active} controller={controller} />;
}

export function ContentReviewComments({
  targetId,
  diagramId,
  presentation = "inline",
  bottomOffset = spacing.sm,
}: {
  targetId: string;
  diagramId?: string;
  presentation?: "inline" | "overlay";
  bottomOffset?: number;
}) {
  const controller = useContext(ContentReviewContext);
  const [expanded, setExpanded] = useState(false);
  const comments = useContentReviewComments(targetId, diagramId);
  const active = controller?.active?.anchor;
  const editingThisTarget = active?.target.id === targetId
    && (diagramId === undefined || active.kind === "mermaid" && active.diagramId === diagramId);
  if (comments.length === 0 || editingThisTarget) return null;
  const latest = comments.at(-1);
  return (
    <View
      pointerEvents="box-none"
      style={presentation === "overlay" ? [styles.commentsOverlay, { bottom: bottomOffset }] : styles.commentsInline}
    >
      <View style={styles.commentsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Hide" : "Show"} ${comments.length} review comments`}
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [styles.commentsSummary, pressed && styles.pressed]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={iconSize.inline} color={REVIEW_PURPLE} />
          <Text numberOfLines={1} style={styles.commentsSummaryText}>
            {comments.length} {comments.length === 1 ? "comment" : "comments"}{latest === undefined ? "" : ` · ${latest.body}`}
          </Text>
          <Ionicons name={expanded ? "chevron-down" : "chevron-up"} size={iconSize.inline} color={colors.textMuted} />
        </Pressable>
        {expanded && (
          <ScrollView nestedScrollEnabled style={styles.commentsList}>
            {comments.map((comment, index) => (
              <View key={comment.id} style={styles.commentRow}>
                <View style={styles.commentOrdinal}><Text style={styles.commentOrdinalText}>{index + 1}</Text></View>
                <View style={styles.commentBody}>
                  <Text numberOfLines={2} style={styles.commentAnchor}>{commentAnchorLabel(comment.anchor)}</Text>
                  <Text selectable style={styles.commentText}>{comment.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function InlineContentReviewComposer({
  active,
  controller,
}: {
  active: ActiveReview;
  controller: ContentReviewController;
}) {
  const dialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const runtime = useSyncExternalStore(controller.runtimeStore.subscribe, controller.runtimeStore.getSnapshot, controller.runtimeStore.getSnapshot);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef("");
  const selectionRef = useRef({ start: 0, end: 0 });
  const { cancel } = controller;
  const voiceScope = `${active.scope}\u0000content-review\u0000${active.id}`;
  const voiceController = runtime?.voiceController ?? null;
  const voiceResource = useScopedVoiceInputResource(runtime?.resources ?? null, voiceScope);
  useEffect(() => () => {
    void voiceController?.finish(voiceScope, false);
    voiceController?.unbind(voiceScope);
    cancel(active.id);
  }, [active.id, cancel, voiceController, voiceScope]);

  const voicePhase = voiceResource?.phase ?? "idle";
  const microphoneAccess = useMicrophoneAccess();
  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  const bindVoice = () => {
    if (runtime?.voiceController === null || runtime?.voiceController === undefined) return;
    runtime.voiceController.bind({
      scope: voiceScope,
      source: () => draftRef.current,
      selection: () => selectionRef.current,
      thread: runtime.thread,
      updateDraft,
      send: updateDraft,
      ...(runtime.startVoice === undefined ? {} : { startRemote: runtime.startVoice }),
    });
  };
  const pressVoice = async () => {
    const voice = runtime?.voiceController;
    if (voice === null || voice === undefined) return;
    if (voicePhase === "idle" && !voiceRetryAvailable && !microphoneAccess.allowCapture()) return;
    bindVoice();
    if (voiceRetryAvailable) await voice.retry(voiceScope);
    else if (voicePhase === "idle") await voice.toggle(voiceScope);
    else if (voicePhase !== "finishing") await voice.finish(voiceScope, false);
  };
  const save = async () => {
    if (saving || draft.trim() === "" || voicePhase !== "idle") return;
    setSaving(true);
    const result = await controller.save(active.id, draft).then(
      (attached) => ({ attached, cause: null }),
      (cause: unknown) => ({ attached: false, cause }),
    );
    setSaving(false);
    if (!result.attached) {
      dialog.alert(
        "Could not attach review",
        result.cause instanceof Error ? result.cause.message : "Review upload failed",
      );
    }
  };
  const canSave = draft.trim() !== "" && voicePhase === "idle" && !saving;

  return (
    <ContentReviewKeyboardDock>
        <View style={[styles.inlineCard, { paddingBottom: Math.max(spacing.sm, insets.bottom) }]}>
          <View style={styles.anchorRow}>
            <View style={styles.anchorMarker} />
            <AnchorSummary anchor={active.anchor} />
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel content review" hitSlop={8} onPress={() => controller.cancel(active.id)} style={styles.closeButton}>
              <Ionicons name="close" size={iconSize.action} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.composerRow}>
            <TextInput
              autoFocus
              multiline
              voiceInput={false}
              value={draft}
              onChangeText={updateDraft}
              onSelectionChange={({ nativeEvent }) => { selectionRef.current = nativeEvent.selection; }}
              placeholder="What should change here?"
              placeholderTextColor={colors.textDim}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voiceRetryAvailable ? "Retry review voice input" : voicePhase === "idle" ? microphoneAccess.granted ? "Review voice input" : "Allow microphone access" : "Stop review voice input"}
              disabled={voicePhase === "finishing" && !voiceRetryAvailable}
              onPress={() => void pressVoice()}
              style={[styles.circleButton, ((voicePhase === "idle" && !microphoneAccess.granted && !voiceRetryAvailable) || (voicePhase === "finishing" && !voiceRetryAvailable)) && styles.disabled]}
            >
              {voicePhase === "starting" || voicePhase === "finishing" && !voiceRetryAvailable
                ? <ActivityIndicator size="small" color={colors.textMuted} />
                : <Ionicons name={voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop"} size={iconSize.action} color={voicePhase === "recording" ? colors.red : colors.text} />}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Save review comment" disabled={!canSave} onPress={() => void save()} style={[styles.saveButton, !canSave && styles.disabled]}>
              {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="checkmark" size={iconSize.action} color={colors.onPrimary} />}
            </Pressable>
          </View>
          {voiceResource?.error !== null && voiceResource?.error !== undefined && (
            <Text style={styles.error}>{voiceResource.error}</Text>
          )}
        </View>
    </ContentReviewKeyboardDock>
  );
}

function AnchorSummary({ anchor }: { anchor: ContentReviewAnchor }) {
  if (anchor.kind === "text") {
    return <Text numberOfLines={2} style={styles.quoteText}>{anchor.quote.trim()}</Text>;
  }
  if (anchor.kind === "response") {
    return <Text numberOfLines={2} style={styles.quoteText}>Entire agent response</Text>;
  }
  return (
    <View style={styles.pointRow}>
      <Ionicons name="pin" size={iconSize.inline} color={REVIEW_PURPLE} />
      <Text style={styles.pointText}>{commentAnchorLabel(anchor)}</Text>
    </View>
  );
}

function commentAnchorLabel(anchor: ContentReviewAnchor): string {
  if (anchor.kind === "text") return `“${anchor.quote.trim()}”`;
  if (anchor.kind === "response") return "Entire agent response";
  return `${anchor.kind === "image" ? "Image" : "Mermaid"} · ${(anchor.x * 100).toFixed(1)}%, ${(anchor.y * 100).toFixed(1)}%`;
}

const REVIEW_PURPLE = "#B794F6";

const styles = StyleSheet.create({
  host: { flex: 1, minWidth: 0, minHeight: 0 },
  inlineCard: { width: "100%", maxWidth: 760, alignSelf: "center", gap: spacing.sm, padding: spacing.sm, borderTopWidth: 1, borderColor: "rgba(183, 148, 246, 0.55)", backgroundColor: colors.surfaceRaised },
  anchorRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  anchorMarker: { width: 3, alignSelf: "stretch", borderRadius: radii.compact, backgroundColor: REVIEW_PURPLE },
  quoteText: { flex: 1, minWidth: 0, color: colors.textMuted, ...typeScale.body, },
  pointRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.compact },
  pointText: { flex: 1, minWidth: 0, color: colors.textMuted, ...typeScale.body, },
  closeButton: { width: controlSize.compact, height: controlSize.compact, alignItems: "center", justifyContent: "center" },
  composerRow: { minWidth: 0, flexDirection: "row", alignItems: "flex-end", gap: spacing.xs },
  input: { flex: 1, minWidth: 0, minHeight: controlSize.touch, maxHeight: 160, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerHigh, color: colors.text, paddingHorizontal: spacing.sm, paddingVertical: spacing.inputInset, ...typeScale.body, },
  circleButton: { width: controlSize.touch, height: controlSize.touch, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerHigh },
  saveButton: { width: controlSize.touch, height: controlSize.touch, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: REVIEW_PURPLE },
  error: { color: colors.red, paddingHorizontal: spacing.xs, textAlign: "center" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.68 },
  commentsInline: { width: "100%", minWidth: 0, marginTop: spacing.sm },
  commentsOverlay: { position: "absolute", left: spacing.sm, right: spacing.sm, zIndex: 90, alignItems: "center" },
  commentsCard: { width: "100%", maxWidth: 760, borderRadius: radii.large, borderWidth: 1, borderColor: "rgba(183, 148, 246, 0.38)", backgroundColor: "rgba(28, 28, 28, 0.97)", overflow: "hidden" },
  commentsSummary: { minHeight: controlSize.touch, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  commentsSummaryText: { minWidth: 0, flex: 1, color: colors.text, ...typeScale.body, },
  commentsList: { maxHeight: 280, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  commentRow: { minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, paddingVertical: spacing.xs },
  commentOrdinal: { width: 22, height: 22, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: REVIEW_PURPLE },
  commentOrdinalText: { color: "#0b0b0b", ...typeScale.label, fontWeight: typeWeight.semibold },
  commentBody: { minWidth: 0, flex: 1, gap: spacing.optical },
  commentAnchor: { color: colors.textMuted, ...typeScale.label, },
  commentText: { color: colors.text, ...typeScale.body, },
});
