import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../data/use-remote-workspace";
import type { VoiceInputRow } from "../data/workspace-resource-database";
import type { VoiceInputController } from "../data/voice-input-controller";
import { colors, radii, spacing } from "../theme";
import { useAppDialog } from "../ui/AppDialog";
import { useAppFullscreenOverlay, type AppFullscreenOverlayController } from "../ui/AppFullscreenOverlay";
import { AppText as Text, AppTextInput as TextInput } from "../ui/Typography";
import {
  serializeContentReviewAttachment,
  type ContentReviewAnchor,
  type ContentReviewComment,
} from "./content-review";

type VoiceStarter = (
  listener: (event: VoiceTranscriptionEvent) => void,
  options?: VoiceTranscriptionOptions,
) => Promise<VoiceTranscriptionSession>;

export type ContentReviewRuntime = {
  attach(markdown: string): Promise<boolean>;
  thread: Thread | null;
  voiceScope: string;
  voiceResource: VoiceInputRow | null;
  voiceController: VoiceInputController | null;
  startVoice?: VoiceStarter;
};

type RuntimeStore = {
  getSnapshot(): ContentReviewRuntime | null;
  subscribe(listener: () => void): () => void;
};

type ContentReviewController = {
  begin(anchor: ContentReviewAnchor): Promise<boolean>;
  registerRuntime(runtime: ContentReviewRuntime): () => void;
};

const ContentReviewContext = createContext<ContentReviewController | null>(null);

export function ContentReviewHost({ children }: { children: ReactNode }) {
  const overlay = useAppFullscreenOverlay({ scope: "content-review" });
  const overlayRef = useRef<AppFullscreenOverlayController>(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);
  const commentsRef = useRef<ContentReviewComment[]>([]);
  const commentsByScopeRef = useRef(new Map<string, ContentReviewComment[]>());
  const activeScopeRef = useRef<string | null>(null);
  const runtimeRef = useRef<ContentReviewRuntime | null>(null);
  const runtimeSubscribersRef = useRef(new Set<() => void>());
  const [comments, setComments] = useState<ContentReviewComment[]>([]);

  const publishComments = (next: ContentReviewComment[], scope: string | null) => {
    if (scope === null) return;
    if (next.length === 0) commentsByScopeRef.current.delete(scope);
    else commentsByScopeRef.current.set(scope, next);
    if (activeScopeRef.current !== scope) return;
    commentsRef.current = next;
    setComments(next);
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

  const presentEditor = (anchor: ContentReviewAnchor | null): Promise<boolean> => {
    const scope = runtimeRef.current?.voiceScope ?? activeScopeRef.current;
    if (scope === null) return Promise.resolve(false);
    const scopedComments = commentsByScopeRef.current.get(scope) ?? [];
    return new Promise((resolve) => {
      let settled = false;
      const settle = (saved: boolean) => {
        if (settled) return;
        settled = true;
        resolve(saved);
      };
      overlayRef.current.present(({ close }) => (
        <ContentReviewEditor
          anchor={anchor}
          initialComments={scopedComments}
          runtimeStore={runtimeStore}
          onUnmount={() => settle(false)}
          onCancel={() => {
            settle(false);
            close();
          }}
          onDelete={(id) => {
            const current = commentsByScopeRef.current.get(scope) ?? [];
            publishComments(current.filter((comment) => comment.id !== id), scope);
          }}
          onSave={(body) => {
            if (anchor === null) return;
            const current = commentsByScopeRef.current.get(scope) ?? [];
            publishComments([...current, createComment(anchor, body)], scope);
            settle(true);
            close();
          }}
          onAttach={async (visibleComments, body) => {
            const next = anchor === null || body.trim() === ""
              ? visibleComments
              : [...visibleComments, createComment(anchor, body)];
            const markdown = serializeContentReviewAttachment(next);
            const runtime = runtimeRef.current;
            if (runtime === null || runtime.voiceScope !== scope || markdown === "") return false;
            const attached = await runtime.attach(markdown);
            if (!attached) return false;
            publishComments([], scope);
            settle(anchor !== null && body.trim() !== "");
            close();
            return true;
          }}
        />
      ));
    });
  };

  const [controller] = useState<ContentReviewController>(() => ({
    begin: (anchor) => presentEditor(anchor),
    registerRuntime(runtime) {
      runtimeRef.current = runtime;
      activeScopeRef.current = runtime.voiceScope;
      const scopedComments = commentsByScopeRef.current.get(runtime.voiceScope) ?? [];
      commentsRef.current = scopedComments;
      setComments(scopedComments);
      notifyRuntime();
      return () => {
        if (runtimeRef.current !== runtime) return;
        runtimeRef.current = null;
        notifyRuntime();
      };
    },
  }));

  return (
    <ContentReviewContext.Provider value={controller}>
      <View style={styles.host}>
        {children}
        {comments.length > 0 && (
          <View pointerEvents="box-none" style={styles.resumeTray}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open content review with ${comments.length} comments`}
              onPress={() => void presentEditor(null)}
              style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}
            >
              <Ionicons name="chatbox-ellipses-outline" size={17} color={colors.text} />
              <Text style={styles.resumeText}>Review · {comments.length}</Text>
              <Ionicons name="chevron-up" size={15} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
      </View>
    </ContentReviewContext.Provider>
  );
}

export function useContentReview(): (anchor: ContentReviewAnchor) => Promise<boolean> {
  const controller = useContext(ContentReviewContext);
  if (controller === null) return async () => false;
  return controller.begin;
}

export function useContentReviewRuntime(runtime: ContentReviewRuntime): void {
  const controller = useContext(ContentReviewContext);
  const attach = useEffectEvent(runtime.attach);
  const startVoice = useEffectEvent(runtime.startVoice ?? (async () => { throw new Error("Voice input is unavailable"); }));
  const { thread, voiceScope, voiceResource, voiceController, startVoice: startVoiceInput } = runtime;
  useEffect(() => {
    if (controller === null) return;
    return controller.registerRuntime({
      attach: (markdown) => attach(markdown),
      thread,
      voiceScope,
      voiceResource,
      voiceController,
      ...(startVoiceInput === undefined ? {} : { startVoice: (listener, options) => startVoice(listener, options) }),
    });
  }, [controller, startVoiceInput, thread, voiceController, voiceResource, voiceScope]);
}

function ContentReviewEditor({
  anchor,
  initialComments,
  runtimeStore,
  onUnmount,
  onCancel,
  onDelete,
  onSave,
  onAttach,
}: {
  anchor: ContentReviewAnchor | null;
  initialComments: ContentReviewComment[];
  runtimeStore: RuntimeStore;
  onUnmount(): void;
  onCancel(): void;
  onDelete(id: string): void;
  onSave(body: string): void;
  onAttach(comments: ContentReviewComment[], body: string): Promise<boolean>;
}) {
  const dialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const runtime = useSyncExternalStore(runtimeStore.subscribe, runtimeStore.getSnapshot, runtimeStore.getSnapshot);
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [attaching, setAttaching] = useState(false);
  const draftRef = useRef("");
  const selectionRef = useRef({ start: 0, end: 0 });
  const unmount = useEffectEvent(onUnmount);
  useEffect(() => () => unmount(), []);
  useEffect(() => () => {
    const current = runtimeStore.getSnapshot();
    if (current?.voiceResource?.phase !== "idle") void current?.voiceController?.finish(false);
    current?.voiceController?.unbind(current.voiceScope);
  }, [runtimeStore]);

  const voicePhase = runtime?.voiceResource?.phase ?? "idle";
  const voiceRetryAvailable = runtime?.voiceResource?.retryAvailable ?? false;
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  const updateSelection = (value: { start: number; end: number }) => {
    selectionRef.current = value;
  };
  const bindVoice = () => {
    if (runtime?.voiceController === null || runtime?.voiceController === undefined) return;
    runtime.voiceController.bind({
      scope: runtime.voiceScope,
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
    bindVoice();
    if (voiceRetryAvailable) await voice.retry();
    else if (voicePhase === "idle") await voice.toggle();
    else if (voicePhase !== "finishing") await voice.finish(false);
  };
  const attach = async () => {
    if (attaching || (comments.length === 0 && (anchor === null || draft.trim() === ""))) return;
    setAttaching(true);
    const result = await onAttach(comments, draft).then(
      (attached) => ({ attached, cause: null }),
      (cause: unknown) => ({ attached: false, cause }),
    );
    setAttaching(false);
    if (result.cause !== null) {
      dialog.alert("Could not attach review", result.cause instanceof Error ? result.cause.message : "Review upload failed");
    } else if (!result.attached) {
      dialog.alert("Could not attach review", "Review upload failed");
    }
  };
  const save = () => {
    if (anchor === null || draft.trim() === "") return;
    onSave(draft);
  };
  const removeComment = (id: string) => {
    setComments((current) => current.filter((comment) => comment.id !== id));
    onDelete(id);
  };
  const canSave = anchor !== null && draft.trim() !== "" && voicePhase === "idle";
  const canAttach = (comments.length > 0 || canSave) && voicePhase === "idle" && !attaching;

  return (
    <View style={styles.editor}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close content review" onPress={onCancel} style={styles.iconButton}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text style={styles.title}>Content review</Text>
          <Text style={styles.subtitle}>{comments.length} saved {comments.length === 1 ? "comment" : "comments"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Attach content review" disabled={!canAttach} onPress={() => void attach()} style={[styles.attachButton, !canAttach && styles.disabled]}>
          {attaching ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="attach" size={18} color={colors.onPrimary} />}
          <Text style={styles.attachText}>Attach</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {comments.map((comment, index) => (
          <View key={comment.id} style={styles.commentCard}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentIndex}>Comment {index + 1}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete comment ${index + 1}`} hitSlop={8} onPress={() => removeComment(comment.id)}>
                <Ionicons name="close-circle" size={18} color={colors.textDim} />
              </Pressable>
            </View>
            <AnchorSummary anchor={comment.anchor} />
            <Text style={styles.commentBody}>{comment.body}</Text>
          </View>
        ))}
        {anchor !== null && (
          <View style={styles.currentAnchor}>
            <Text style={styles.currentLabel}>New comment</Text>
            <AnchorSummary anchor={anchor} />
          </View>
        )}
      </ScrollView>
      {anchor !== null && (
        <KeyboardStickyView
          offset={{ closed: 0, opened: insets.bottom }}
          style={styles.composerSticky}
        >
          <View style={styles.composer}>
            <TextInput
              autoFocus
              multiline
              voiceInput={false}
              value={draft}
              onChangeText={updateDraft}
              onSelectionChange={({ nativeEvent }) => updateSelection(nativeEvent.selection)}
              placeholder="What should change here?"
              placeholderTextColor={colors.textDim}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voiceRetryAvailable ? "Retry review voice input" : voicePhase === "idle" ? "Review voice input" : "Stop review voice input"}
              disabled={voicePhase === "finishing" && !voiceRetryAvailable}
              onPress={() => void pressVoice()}
              style={[styles.voiceButton, voicePhase === "finishing" && !voiceRetryAvailable && styles.disabled]}
            >
              {voicePhase === "starting" || voicePhase === "finishing" && !voiceRetryAvailable
                ? <ActivityIndicator size="small" color={colors.textMuted} />
                : <Ionicons name={voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop"} size={20} color={voicePhase === "recording" ? colors.red : colors.text} />}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Save review comment" disabled={!canSave} onPress={save} style={[styles.saveButton, !canSave && styles.disabled]}>
              <Ionicons name="checkmark" size={21} color={colors.onPrimary} />
            </Pressable>
          </View>
          {runtime?.voiceResource?.error !== null && runtime?.voiceResource?.error !== undefined && (
            <Text style={styles.error}>{runtime.voiceResource.error}</Text>
          )}
        </KeyboardStickyView>
      )}
    </View>
  );
}

function AnchorSummary({ anchor }: { anchor: ContentReviewAnchor }) {
  if (anchor.kind === "text") {
    return (
      <View style={styles.quote}>
        <Text numberOfLines={5} style={styles.quoteText}>{anchor.quote.trim()}</Text>
      </View>
    );
  }
  return (
    <View style={styles.pointRow}>
      <Ionicons name="pin" size={16} color={colors.accent} />
      <Text style={styles.pointText}>Mermaid · {(anchor.x * 100).toFixed(1)}%, {(anchor.y * 100).toFixed(1)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, minWidth: 0, minHeight: 0 },
  resumeTray: { position: "absolute", left: 0, right: 0, bottom: 82, alignItems: "center" },
  resumeButton: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceContainerHigh },
  resumeText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  editor: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  headerTitle: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  attachButton: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, borderRadius: 19, backgroundColor: colors.accent },
  attachText: { color: colors.onPrimary, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { width: "100%", maxWidth: 760, alignSelf: "center", padding: spacing.md, gap: spacing.sm },
  commentCard: { borderRadius: radii.medium, padding: spacing.md, gap: 8, backgroundColor: colors.surfaceRaised },
  commentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  commentIndex: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700", textTransform: "uppercase" },
  commentBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  currentAnchor: { borderRadius: radii.medium, borderWidth: 1, borderColor: colors.accent, padding: spacing.md, gap: 8 },
  currentLabel: { color: colors.accent, fontSize: 11, lineHeight: 15, fontWeight: "700", textTransform: "uppercase" },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm },
  quoteText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  pointRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pointText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  composerSticky: { flexShrink: 0, backgroundColor: colors.background },
  composer: { width: "100%", maxWidth: 760, alignSelf: "center", flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  input: { flex: 1, minWidth: 0, minHeight: 48, maxHeight: 160, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerHigh, color: colors.text, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  voiceButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerHigh },
  saveButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  error: { color: colors.red, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, textAlign: "center" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
