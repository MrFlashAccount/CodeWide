import { useId, useLayoutEffect, useState, useTransition } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text, AppTextInput as TextInput } from "../../../ui/Typography";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "../../../ui/VoiceInputRuntime";
import { WaveText } from "../../../ui/WaveText";
import type { BrowserFeedbackCapability, BrowserFeedbackDraft } from "./feedback";

interface FeedbackDialogProps {
  readonly draft: BrowserFeedbackDraft;
  readonly capability: BrowserFeedbackCapability;
  readonly onClose: () => void;
}

/** Nothing is uploaded until the user reviews the package and explicitly sends it. */
export function BrowserFeedbackDialog(props: FeedbackDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [destination, setDestination] = useState(props.capability.initialDestination);
  const [screenshot, setScreenshot] = useState(true);
  const [errors, setErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [abort] = useState(() => new AbortController());
  useLayoutEffect(() => () => abort.abort(), [abort]);
  const voiceScope = `browser-feedback:${useId()}`;
  const voiceRuntime = useAppVoiceInputRuntime();
  const voice = useVoiceInputResource(voiceRuntime, voiceScope);
  const voiceBusy = voice !== null && voice.phase !== "idle";
  const close = useEvent(() => {
    if (!pending) props.onClose();
  });
  const submit = useEvent(() => {
    if (
      pending ||
      voiceBusy ||
      prompt.trim() === "" ||
      !props.capability.destinations.some((entry) => entry.id === destination)
    )
      return;
    const submission = {
      destination,
      prompt,
      report: props.draft.report,
      screenshot: screenshot ? props.draft.screenshot : null,
      includeErrors: errors,
    };
    startTransition(async () => {
      setError(null);
      let errorMessage: string | null = null;
      try {
        await props.capability.send(submission, abort.signal);
      } catch (cause) {
        errorMessage = cause instanceof Error ? cause.message : "Could not send browser feedback";
      }
      if (abort.signal.aborted) return;
      if (errorMessage === null) props.onClose();
      else setError(errorMessage);
    });
  });
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable disabled={pending} onPress={close} style={styles.button}>
          <Text style={styles.label}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Fix this element</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <TextInput
          accessibilityLabel="Describe the browser issue"
          voiceScope={voiceScope}
          editable={!pending}
          multiline
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What should change?"
          style={styles.input}
        />
        <ActionMenu
          accessibilityLabel="Destination chat"
          actions={props.capability.destinations.map((entry) => ({
            id: entry.id,
            label: entry.label,
            disabled: pending,
          }))}
          onSelect={setDestination}
        >
          <Pressable style={styles.button}>
            <Text style={styles.label}>
              {props.capability.destinations.find((entry) => entry.id === destination)?.label ??
                "Choose a chat"}
            </Text>
          </Pressable>
        </ActionMenu>
        <Text selectable style={styles.caption}>
          {props.draft.report.url}
          {"\n"}
          {props.draft.report.selector}
        </Text>
        {props.draft.screenshot !== null && (
          <>
            <View style={styles.header}>
              <Text style={styles.label}>Include marked screenshot</Text>
              <Switch value={screenshot} onValueChange={setScreenshot} disabled={pending} />
            </View>
            {screenshot && (
              <Image
                accessibilityLabel="Screenshot to send"
                source={{ uri: `data:image/png;base64,${props.draft.screenshot}` }}
                resizeMode="contain"
                style={styles.screenshot}
              />
            )}
          </>
        )}
        {props.draft.screenshotError !== null && (
          <Text style={styles.error}>Screenshot unavailable: {props.draft.screenshotError}</Text>
        )}
        <Text style={styles.caption}>
          Selected element · {props.draft.report.viewport.width} ×{" "}
          {props.draft.report.viewport.height}
        </Text>
        <Text selectable style={styles.code}>
          {props.draft.report.html}
        </Text>
        <View style={styles.header}>
          <Text style={styles.label}>
            Include console / network failures ({props.draft.report.errors.length})
          </Text>
          <Switch value={errors} onValueChange={setErrors} disabled={pending} />
        </View>
        {errors && (
          <Text selectable style={styles.code}>
            {props.draft.report.errors.join("\n") || "No captured failures"}
          </Text>
        )}
        <Text style={styles.caption}>
          Review before sending. Request headers, bodies and form values are not collected. URL
          secrets and common credential patterns are removed; visible page content may still be
          private.
        </Text>
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <Pressable
        onPress={submit}
        disabled={pending || voiceBusy || prompt.trim() === "" || destination === ""}
        style={styles.send}
        accessibilityRole="button"
      >
        {pending ? (
          <WaveText text="Sending to chat" style={styles.label} />
        ) : (
          <Text style={styles.label}>
            {voiceBusy ? "Finish dictation before sending" : "Send to chat"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  title: { ...typeScale.body, color: colors.text, flex: 1 },
  label: { ...typeScale.body, color: colors.text },
  button: { padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.medium },
  content: { padding: spacing.md, gap: spacing.md },
  input: {
    minHeight: 100,
    padding: spacing.md,
    ...typeScale.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
  },
  screenshot: { height: 240, width: "100%" },
  code: { ...typeScale.caption, color: colors.textMuted },
  caption: { ...typeScale.caption, color: colors.textMuted },
  error: { ...typeScale.caption, color: colors.error },
  send: {
    padding: spacing.md,
    margin: spacing.md,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
  },
});
