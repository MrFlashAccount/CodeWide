import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
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

import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../data/voice-input-controller";
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
  attach: (markdown: string) => Promise<string | null>;
  attachmentId: string | null;
  resources: WorkspaceResourceDatabase | null;
  startVoice?: VoiceStarter;
  thread: Thread | null;
  voiceController: VoiceInputController | null;
  voiceScope: string;
};

type RuntimeStore = {
  getSnapshot: () => ContentReviewRuntime | null;
  subscribe: (listener: () => void) => () => void;
};

type ActiveReview = {
  anchor: ContentReviewAnchor;
  id: string;
  scope: string;
};

type ContentReviewController = {
  active: ActiveReview | null;
  begin: (anchor: ContentReviewAnchor) => void;
  cancel: (id: string) => void;
  comments: readonly ContentReviewComment[];
  registerRuntime: (runtime: ContentReviewRuntime) => () => void;
  runtimeStore: RuntimeStore;
  save: (id: string, body: string) => Promise<boolean>;
};

export type ContentReviewHighlight = { end: number; start: number };
export type ContentReviewPoint = {
  id: string;
  pending: boolean;
  x: number;
  y: number;
};

const EMPTY_CONTENT_REVIEW_COMMENTS: ContentReviewComment[] = [];
const ContentReviewContext = createContext<ContentReviewController | null>(null);

function createContentReviewComment(
  anchor: ContentReviewAnchor,
  body: string,
): ContentReviewComment {
  return {
    anchor,
    body: body.trim(),
    createdAt: Date.now(),
    id: `content-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  };
}

/** Owns review comments and active review scope for nested content renderers. */
export function ContentReviewHost({ children }: { children: ReactNode }) {
  const commentsByScopeRef = useRef(new Map<string, ContentReviewComment[]>());
  const attachmentByScopeRef = useRef(new Map<string, string>());
  const activeScopeRef = useRef<string | null>(null);
  const activeRef = useRef<ActiveReview | null>(null);
  const runtimeRef = useRef<ContentReviewRuntime | null>(null);
  const runtimeSubscribersRef = useRef(new Set<() => void>());
  const [comments, setComments] = useState<ContentReviewComment[]>([]);
  const [active, setActive] = useState<ActiveReview | null>(null);

  const publishComments = (next: ContentReviewComment[], scope: string) => {
    if (next.length === 0) {
      commentsByScopeRef.current.delete(scope);
    } else {
      commentsByScopeRef.current.set(scope, next);
    }
    if (activeScopeRef.current === scope) {
      setComments(next);
    }
  };
  const settleActive = () => {
    activeRef.current = null;
    setActive(null);
  };
  const runtimeStore: RuntimeStore = {
    getSnapshot: () => runtimeRef.current,
    subscribe(listener) {
      runtimeSubscribersRef.current.add(listener);
      return () => {
        runtimeSubscribersRef.current.delete(listener);
      };
    },
  };
  const notifyRuntime = () => {
    for (const listener of runtimeSubscribersRef.current) {
      listener();
    }
  };
  const begin = (anchor: ContentReviewAnchor): void => {
    const scope = runtimeRef.current?.voiceScope ?? activeScopeRef.current;
    if (scope === null) {
      return;
    }
    settleActive();
    const next: ActiveReview = {
      anchor,
      id: `content-review-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      scope,
    };
    activeRef.current = next;
    setActive(next);
  };
  const cancel = (id: string) => {
    if (activeRef.current?.id === id) {
      settleActive();
    }
  };
  const save = async (id: string, body: string): Promise<boolean> => {
    const current = activeRef.current;
    const runtime = runtimeRef.current;
    const trimmed = body.trim();
    if (
      current === null ||
      current.id !== id ||
      trimmed === "" ||
      runtime === null ||
      runtime.voiceScope !== current.scope
    ) {
      return false;
    }
    const next = [
      ...(commentsByScopeRef.current.get(current.scope) ?? []),
      createContentReviewComment(current.anchor, trimmed),
    ];
    const markdown = serializeContentReviewAttachment(next);
    if (markdown === "") {
      return false;
    }
    const attachmentId = await runtime.attach(markdown);
    if (attachmentId === null) {
      return false;
    }
    attachmentByScopeRef.current.set(current.scope, attachmentId);
    publishComments(next, current.scope);
    if (activeRef.current?.id === id) {
      settleActive();
    }
    return true;
  };
  const registerRuntime = (runtime: ContentReviewRuntime): (() => void) => {
    const previousScope = activeScopeRef.current;
    if (
      previousScope !== null &&
      previousScope !== runtime.voiceScope &&
      activeRef.current?.scope === previousScope
    ) {
      settleActive();
    }
    activeScopeRef.current = runtime.voiceScope;
    runtimeRef.current = runtime;
    const knownAttachment = attachmentByScopeRef.current.get(runtime.voiceScope) ?? null;
    if (knownAttachment !== null && runtime.attachmentId === null) {
      attachmentByScopeRef.current.delete(runtime.voiceScope);
      publishComments([], runtime.voiceScope);
      if (activeRef.current?.scope === runtime.voiceScope) {
        settleActive();
      }
    } else if (runtime.attachmentId !== null) {
      attachmentByScopeRef.current.set(runtime.voiceScope, runtime.attachmentId);
    }
    setComments(
      commentsByScopeRef.current.get(runtime.voiceScope) ?? EMPTY_CONTENT_REVIEW_COMMENTS,
    );
    notifyRuntime();
    return () => {
      if (runtimeRef.current !== runtime) {
        return;
      }
      runtimeRef.current = null;
      notifyRuntime();
    };
  };

  const actions = useConstant(() => ({
    begin,
    cancel,
    registerRuntime,
    runtimeStore,
    save,
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

export function useContentReview(): (anchor: ContentReviewAnchor) => void {
  const controller = useContext(ContentReviewContext);
  return useEvent((anchor: ContentReviewAnchor) => {
    controller?.begin(anchor);
  });
}

export function useContentReviewHighlights(
  targetId: string,
  blockPath: string,
  offset = 0,
): readonly ContentReviewHighlight[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) {
    return [];
  }
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
  if (controller === null) {
    return EMPTY_CONTENT_REVIEW_COMMENTS;
  }
  return controller.comments.filter((comment) => {
    if (comment.anchor.target.id !== targetId) {
      return false;
    }
    if (diagramId === undefined) {
      return true;
    }
    return comment.anchor.kind === "mermaid" && comment.anchor.diagramId === diagramId;
  });
}

export function useContentReviewPoints(
  targetId: string,
  diagramId: string,
): readonly ContentReviewPoint[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) {
    return [];
  }
  const saved = controller.comments.flatMap((comment) => {
    const anchor = comment.anchor;
    return anchor.kind === "mermaid" &&
      anchor.target.id === targetId &&
      anchor.diagramId === diagramId
      ? [{ id: comment.id, pending: false, x: anchor.x, y: anchor.y }]
      : [];
  });
  const activeAnchor = controller.active?.anchor;
  if (
    activeAnchor?.kind !== "mermaid" ||
    activeAnchor.target.id !== targetId ||
    activeAnchor.diagramId !== diagramId
  ) {
    return saved;
  }
  return [
    ...saved,
    { id: controller.active?.id ?? "pending", pending: true, x: activeAnchor.x, y: activeAnchor.y },
  ];
}

export function useContentReviewRuntime(runtime: ContentReviewRuntime): void {
  const controller = useContext(ContentReviewContext);
  const registerRuntime = controller?.registerRuntime;
  const attach = useEvent(runtime.attach);
  const {
    attachmentId,
    resources,
    startVoice: startVoiceInput,
    thread,
    voiceController,
    voiceScope,
  } = runtime;
  useEffect(() => {
    if (registerRuntime === undefined) {
      return undefined;
    }
    return registerRuntime({
      attach: async (markdown) => attach(markdown),
      attachmentId,
      resources,
      thread,
      voiceController,
      voiceScope,
      // A recording retains its originating server/thread while native capture
      // starts. A latest-render callback could connect it to another chat.
      ...(startVoiceInput === undefined ? {} : { startVoice: startVoiceInput }),
    });
  }, [
    attach,
    attachmentId,
    registerRuntime,
    startVoiceInput,
    thread,
    voiceController,
    resources,
    voiceScope,
  ]);
}

export function useImageReviewPoints(targetId: string): readonly ContentReviewPoint[] {
  const controller = useContext(ContentReviewContext);
  if (controller === null) {
    return [];
  }
  const points: ContentReviewPoint[] = [];
  for (const comment of controller.comments) {
    const anchor = comment.anchor;
    if (anchor.kind === "image" && anchor.target.id === targetId) {
      points.push({ id: comment.id, pending: false, x: anchor.x, y: anchor.y });
    }
  }
  const active = controller.active;
  if (active?.anchor.kind === "image" && active.anchor.target.id === targetId) {
    points.push({ id: active.id, pending: true, x: active.anchor.x, y: active.anchor.y });
  }
  return points;
}

export function ContentReviewComposer({
  anchorKind,
  diagramId,
  targetId,
  targetPrefix,
}: {
  anchorKind?: ContentReviewAnchor["kind"];
  diagramId?: string;
  targetId?: string;
  targetPrefix?: string;
}) {
  const controller = useContext(ContentReviewContext);
  const active = controller?.active ?? null;
  if (controller === null || active === null) {
    return null;
  }
  if (targetId !== undefined && active.anchor.target.id !== targetId) {
    return null;
  }
  if (targetPrefix !== undefined && !active.anchor.target.id.startsWith(targetPrefix)) {
    return null;
  }
  if (anchorKind !== undefined && active.anchor.kind !== anchorKind) {
    return null;
  }
  if (
    diagramId !== undefined &&
    (active.anchor.kind !== "mermaid" || active.anchor.diagramId !== diagramId)
  ) {
    return null;
  }
  return <InlineContentReviewComposer active={active} controller={controller} key={active.id} />;
}

export function ContentReviewComments({
  bottomOffset = spacing.sm,
  diagramId,
  presentation = "inline",
  targetId,
}: {
  bottomOffset?: number;
  diagramId?: string;
  presentation?: "inline" | "overlay";
  targetId: string;
}) {
  const controller = useContext(ContentReviewContext);
  const [expanded, setExpanded] = useState(false);
  const comments = useContentReviewComments(targetId, diagramId);
  const active = controller?.active?.anchor;
  const editingThisTarget =
    active?.target.id === targetId &&
    (diagramId === undefined || (active.kind === "mermaid" && active.diagramId === diagramId));
  if (comments.length === 0 || editingThisTarget) {
    return null;
  }
  const latest = comments.at(-1);
  return (
    <View
      pointerEvents="box-none"
      style={
        presentation === "overlay"
          ? [styles.commentsOverlay, { bottom: bottomOffset }]
          : styles.commentsInline
      }
    >
      <View style={styles.commentsCard}>
        <Pressable
          accessibilityLabel={`${expanded ? "Hide" : "Show"} ${String(comments.length)} review comments`}
          accessibilityRole="button"
          onPress={() => {
            setExpanded((current) => !current);
          }}
          style={({ pressed }) => [styles.commentsSummary, pressed && styles.pressed]}
        >
          <Ionicons
            color={REVIEW_PURPLE}
            name="chatbubble-ellipses-outline"
            size={iconSize.inline}
          />
          <Text numberOfLines={1} style={styles.commentsSummaryText}>
            {comments.length} {comments.length === 1 ? "comment" : "comments"}
            {latest === undefined ? "" : ` · ${latest.body}`}
          </Text>
          <Ionicons
            color={colors.textMuted}
            name={expanded ? "chevron-down" : "chevron-up"}
            size={iconSize.inline}
          />
        </Pressable>
        {expanded && (
          <ScrollView nestedScrollEnabled style={styles.commentsList}>
            {comments.map((comment, index) => (
              <View key={comment.id} style={styles.commentRow}>
                <View style={styles.commentOrdinal}>
                  <Text style={styles.commentOrdinalText}>{index + 1}</Text>
                </View>
                <View style={styles.commentBody}>
                  <Text numberOfLines={2} style={styles.commentAnchor}>
                    {commentAnchorLabel(comment.anchor)}
                  </Text>
                  <Text selectable style={styles.commentText}>
                    {comment.body}
                  </Text>
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
  const runtime = useSyncExternalStore(
    controller.runtimeStore.subscribe,
    controller.runtimeStore.getSnapshot,
    controller.runtimeStore.getSnapshot,
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef("");
  const selectionRef = useRef({ end: 0, start: 0 });
  const { cancel } = controller;
  const voiceScope = `${active.scope}\u0000content-review\u0000${active.id}`;
  const voiceController = runtime?.voiceController ?? null;
  const voiceResource = useScopedVoiceInputResource(runtime?.resources ?? null, voiceScope);
  useEffect(
    () => () => {
      voiceController?.finish(voiceScope, false).catch(() => undefined);
      voiceController?.unbind(voiceScope);
      cancel(active.id);
    },
    [active.id, cancel, voiceController, voiceScope],
  );

  const voicePhase = voiceResource?.phase ?? "idle";
  const microphoneAccess = useMicrophoneAccess();
  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  const bindVoice = () => {
    if (runtime?.voiceController === null || runtime?.voiceController === undefined) {
      return;
    }
    runtime.voiceController.bind({
      scope: voiceScope,
      selection: () => selectionRef.current,
      send: updateDraft,
      source: () => draftRef.current,
      thread: runtime.thread,
      updateDraft,
      ...(runtime.startVoice === undefined ? {} : { startRemote: runtime.startVoice }),
    });
  };
  const pressVoice = async () => {
    const voice = runtime?.voiceController;
    if (voice === null || voice === undefined) {
      return;
    }
    if (voicePhase === "idle" && !voiceRetryAvailable && !microphoneAccess.allowCapture()) {
      return;
    }
    bindVoice();
    if (voiceRetryAvailable) {
      await voice.retry(voiceScope);
    } else if (voicePhase === "idle") {
      await voice.toggle(voiceScope);
    } else if (voicePhase !== "finishing") {
      await voice.finish(voiceScope, false);
    }
  };
  const save = async () => {
    if (saving || draft.trim() === "" || voicePhase !== "idle") {
      return;
    }
    setSaving(true);
    const result = await controller.save(active.id, draft).then(
      (attached) => ({ attached, error: null }),
      (error: unknown) => ({ attached: false, error }),
    );
    if (!result.attached) {
      dialog.alert(
        "Could not attach review",
        result.error instanceof Error ? result.error.message : "Review upload failed",
      );
    }
    // WHY: The save Promise handles both settlements above; React Compiler cannot lower a try/finally block in this component.
    // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
    setSaving(false);
  };
  const canSave = draft.trim() !== "" && voicePhase === "idle" && !saving;

  return (
    <ContentReviewKeyboardDock>
      <View style={[styles.inlineCard, { paddingBottom: Math.max(spacing.sm, insets.bottom) }]}>
        <View style={styles.anchorRow}>
          <View style={styles.anchorMarker} />
          <AnchorSummary anchor={active.anchor} />
          <Pressable
            accessibilityLabel="Cancel content review"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              controller.cancel(active.id);
            }}
            style={styles.closeButton}
          >
            <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
          </Pressable>
        </View>
        <View style={styles.composerRow}>
          <TextInput
            autoFocus
            multiline
            onChangeText={updateDraft}
            onSelectionChange={({ nativeEvent }) => {
              selectionRef.current = nativeEvent.selection;
            }}
            placeholder="What should change here?"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={draft}
            voiceInput={false}
          />
          <Pressable
            accessibilityLabel={
              voiceRetryAvailable
                ? "Retry review voice input"
                : voicePhase === "idle"
                  ? microphoneAccess.granted
                    ? "Review voice input"
                    : "Allow microphone access"
                  : "Stop review voice input"
            }
            accessibilityRole="button"
            disabled={voicePhase === "finishing" && !voiceRetryAvailable}
            onPress={() => void pressVoice()}
            style={[
              styles.circleButton,
              ((voicePhase === "idle" && !microphoneAccess.granted && !voiceRetryAvailable) ||
                (voicePhase === "finishing" && !voiceRetryAvailable)) &&
                styles.disabled,
            ]}
          >
            {voicePhase === "starting" || (voicePhase === "finishing" && !voiceRetryAvailable) ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Ionicons
                color={voicePhase === "recording" ? colors.red : colors.text}
                name={
                  voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop"
                }
                size={iconSize.action}
              />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Save review comment"
            accessibilityRole="button"
            disabled={!canSave}
            onPress={() => void save()}
            style={[styles.saveButton, !canSave && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Ionicons color={colors.onPrimary} name="checkmark" size={iconSize.action} />
            )}
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
    return (
      <Text numberOfLines={2} style={styles.quoteText}>
        {anchor.quote.trim()}
      </Text>
    );
  }
  if (anchor.kind === "response") {
    return (
      <Text numberOfLines={2} style={styles.quoteText}>
        Entire agent response
      </Text>
    );
  }
  return (
    <View style={styles.pointRow}>
      <Ionicons color={REVIEW_PURPLE} name="pin" size={iconSize.inline} />
      <Text style={styles.pointText}>{commentAnchorLabel(anchor)}</Text>
    </View>
  );
}

function commentAnchorLabel(anchor: ContentReviewAnchor): string {
  if (anchor.kind === "text") {
    return `“${anchor.quote.trim()}”`;
  }
  if (anchor.kind === "response") {
    return "Entire agent response";
  }
  return `${anchor.kind === "image" ? "Image" : "Mermaid"} · ${(anchor.x * 100).toFixed(1)}%, ${(anchor.y * 100).toFixed(1)}%`;
}

const REVIEW_PURPLE = "#B794F6";

const styles = StyleSheet.create({
  anchorMarker: {
    alignSelf: "stretch",
    backgroundColor: REVIEW_PURPLE,
    borderRadius: radii.compact,
    width: 3,
  },
  anchorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  circleButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  closeButton: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  commentAnchor: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  commentBody: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  commentOrdinal: {
    alignItems: "center",
    backgroundColor: REVIEW_PURPLE,
    borderRadius: radii.pill,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  commentOrdinalText: {
    color: "#0b0b0b",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  commentRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  commentsCard: {
    backgroundColor: "rgba(28, 28, 28, 0.97)",
    borderColor: "rgba(183, 148, 246, 0.38)",
    borderRadius: radii.large,
    borderWidth: 1,
    maxWidth: 760,
    overflow: "hidden",
    width: "100%",
  },
  commentsInline: {
    marginTop: spacing.sm,
    minWidth: 0,
    width: "100%",
  },
  commentsList: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    maxHeight: 280,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  commentsOverlay: {
    alignItems: "center",
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
    zIndex: 90,
  },
  commentsSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.touch,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  commentsSummaryText: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
  },
  commentText: {
    color: colors.text,
    ...typeScale.body,
  },
  composerRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  disabled: { opacity: 0.4 },
  error: {
    color: colors.red,
    paddingHorizontal: spacing.xs,
    textAlign: "center",
  },
  host: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  inlineCard: {
    alignSelf: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: "rgba(183, 148, 246, 0.55)",
    borderTopWidth: 1,
    gap: spacing.sm,
    maxWidth: 760,
    padding: spacing.sm,
    width: "100%",
  },
  input: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    color: colors.text,
    flex: 1,
    maxHeight: 160,
    minHeight: controlSize.touch,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.inputInset,
    ...typeScale.body,
  },
  pointRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.compact,
    minWidth: 0,
  },
  pointText: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
  },
  pressed: { opacity: 0.68 },
  quoteText: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: REVIEW_PURPLE,
    borderRadius: radii.pill,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
});
