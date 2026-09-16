import { useId, useLayoutEffect, useState, useTransition } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text, AppTextInput as TextInput } from "../../../ui/Typography";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "../../../ui/VoiceInputRuntime";
import { WaveText } from "../../../ui/WaveText";
import type { BrowserFeedbackCapability, BrowserFeedbackDraft } from "./feedback";

interface FeedbackDialogProps {
  readonly capability: BrowserFeedbackCapability;
  readonly draft: BrowserFeedbackDraft;
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
  const abort = useConstant(() => new AbortController());
  useLayoutEffect(
    () => () => {
      abort.abort();
    },
    [abort],
  );
  const voiceScope = `browser-feedback:${useId()}`;
  const voiceRuntime = useAppVoiceInputRuntime();
  const voice = useVoiceInputResource(voiceRuntime, voiceScope);
  const voiceBusy = voice !== null && voice.phase !== "idle";
  const close = useEvent(() => {
    if (!pending) {
      props.onClose();
    }
  });
  const submit = useEvent(() => {
    if (
      pending ||
      voiceBusy ||
      prompt.trim() === "" ||
      !props.capability.destinations.some((entry) => entry.id === destination)
    ) {
      return;
    }
    const submission = {
      destination,
      includeErrors: errors,
      prompt,
      report: props.draft.report,
      screenshot: screenshot ? props.draft.screenshot : null,
    };
    startTransition(async () => {
      setError(null);
      let errorMessage: string | null = null;
      try {
        await props.capability.send(submission, abort.signal);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Could not send browser feedback";
      }
      if (abort.signal.aborted) {
        return;
      }
      if (errorMessage === null) {
        props.onClose();
      } else {
        setError(errorMessage);
      }
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          accessibilityLabel="Describe the browser issue"
          editable={!pending}
          multiline
          onChangeText={setPrompt}
          placeholder="What should change?"
          style={styles.input}
          value={prompt}
          voiceScope={voiceScope}
        />
        <ActionMenu
          accessibilityLabel="Destination chat"
          actions={props.capability.destinations.map((entry) => ({
            disabled: pending,
            id: entry.id,
            label: entry.label,
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
              <Switch disabled={pending} onValueChange={setScreenshot} value={screenshot} />
            </View>
            {screenshot && (
              <Image
                accessibilityLabel="Screenshot to send"
                resizeMode="contain"
                source={{ uri: `data:image/png;base64,${props.draft.screenshot}` }}
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
          <Switch disabled={pending} onValueChange={setErrors} value={errors} />
        </View>
        {errors && (
          <Text selectable style={styles.code}>
            {props.draft.report.errors.length === 0
              ? "No captured failures"
              : props.draft.report.errors.join("\n")}
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
        accessibilityRole="button"
        disabled={pending || voiceBusy || prompt.trim() === "" || destination === ""}
        onPress={submit}
        style={styles.send}
      >
        {pending ? (
          <WaveText style={styles.label} text="Sending to chat" />
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
  button: {
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    padding: spacing.sm,
  },
  caption: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  code: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
  },
  error: {
    ...typeScale.caption,
    color: colors.error,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  input: {
    minHeight: 100,
    padding: spacing.md,
    ...typeScale.body,
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    color: colors.text,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenshot: {
    height: 240,
    width: "100%",
  },
  send: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    margin: spacing.md,
    padding: spacing.md,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
  },
});
