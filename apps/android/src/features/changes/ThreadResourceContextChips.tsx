/** V1 ThreadResourceContextChips owner, extracted without changing interaction or resource lifetime. */
import { Pressable } from "react-native";
import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import { useThreadResources } from "../../data/use-thread-resources";
import {
  type ThreadChangeScope,
  type ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import { changeScopeMenuActions, changeScopeTitle } from "../../rendering/change-menu";
import { colors } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount, ComposerContextLabel } from "../../ui/ResourceContextChip";
import { type ChangesPreferences } from "./changePresentation";
import { styles } from "./ThreadResourceContextChips.styles";

export function ThreadResourceContextChips({
  model,
  resourceId,
  revision,
  load,
  preferences,
  onPreferencesChange,
  onOpen,
}: {
  model: ThreadResourcesModel | null;
  resourceId: string | null;
  revision: string;
  load(
    scope?: ThreadChangeScope,
    kind?: "all" | "changes" | "attachments",
  ): Promise<ThreadResourcesValue>;
  preferences: ChangesPreferences;
  onPreferencesChange(preferences: ChangesPreferences): void;
  onOpen(kind: "changes" | "attachments"): void;
}) {
  const dialog = useAppDialog();
  const resource = useThreadResources(model, resourceId, () => load(), { revision });
  const pending = (kind: "changes" | "attachments") =>
    resource === null ||
    (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes(kind));
  const ready = (kind: "changes" | "attachments") =>
    resource?.readyKinds === undefined
      ? resource?.value != null
      : resource.readyKinds.includes(kind);
  const changesPending = pending("changes");
  const attachmentsPending = pending("attachments");
  const changesReady = ready("changes");
  const attachmentsReady = ready("attachments");
  const changesInitialLoading = changesPending && !changesReady;
  const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;
  const changesError =
    resource?.resourceErrors?.changes ??
    (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const attachmentsError =
    resource?.resourceErrors?.attachments ??
    (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const changesUnavailable = changesError !== null && !changesReady;
  const attachmentsUnavailable = attachmentsError !== null && !attachmentsReady;
  const changeCount = resource?.value?.changes.length ?? 0;
  const attachmentCount = resource?.value?.attachments.length ?? 0;
  const changeScopes = resource?.value?.changeScopes ?? ["session" as const, "lastTurn" as const];
  const changeScope =
    preferences.scope !== null && changeScopes.includes(preferences.scope)
      ? preferences.scope
      : (resource?.value?.changeScope ?? changeScopes[0] ?? "session");
  const changesEmpty = changesReady && changeCount === 0;
  const attachmentsEmpty = attachmentsReady && attachmentCount === 0;
  const changesLabel = changesInitialLoading
    ? "Loading changes…"
    : changesUnavailable
      ? "Changes unavailable"
      : changesEmpty
        ? "No changes"
        : `Changes · ${changeCount}`;
  const attachmentsLabel = attachmentsInitialLoading
    ? "Loading attachments…"
    : attachmentsUnavailable
      ? "Attachments unavailable"
      : attachmentsEmpty
        ? "No attachments"
        : `Attachments · ${attachmentCount}`;
  const selectScope = (id: string) => {
    if (!id.startsWith("scope:")) return;
    const scope = id.slice("scope:".length) as ThreadChangeScope;
    if (!changeScopes.includes(scope)) return;
    onPreferencesChange({ ...preferences, scope });
    void load(scope, "changes").catch((cause) => {
      dialog.alert(
        "Changes unavailable",
        cause instanceof Error ? cause.message : "Could not load changes",
      );
    });
  };
  return (
    <>
      {!changesUnavailable && (
        <ActionMenu
          accessibilityLabel="Choose changes scope"
          actions={changeScopeMenuActions(changeScopes, changeScope)}
          trigger="long-press"
          placement="top"
          align="start"
          onSelect={selectScope}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${changesLabel}, ${changeScopeTitle(changeScope)}. Long press to choose changes scope.`}
            onPress={() => onOpen("changes")}
            style={styles.composerContextChip}
          >
            <InlineIcon
              name="git-compare-outline"
              role="label"
              color={changesEmpty ? colors.textDim : colors.textMuted}
            />
            {changesInitialLoading || changesEmpty ? (
              <ComposerContextLabel
                loading={changesInitialLoading}
                testID="composer-changes-label"
                text={changesLabel}
              />
            ) : (
              <ComposerContextCount
                label="Changes"
                value={changeCount}
                testID="composer-changes-label"
              />
            )}
          </Pressable>
        </ActionMenu>
      )}
      {!attachmentsUnavailable && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={attachmentsLabel}
          accessibilityState={{ disabled: attachmentsEmpty }}
          disabled={attachmentsEmpty}
          onPress={() => onOpen("attachments")}
          style={[styles.composerContextChip, attachmentsEmpty && styles.disabled]}
        >
          <InlineIcon
            name="attach-outline"
            role="label"
            color={attachmentsEmpty ? colors.textDim : colors.textMuted}
          />
          {attachmentsInitialLoading || attachmentsEmpty ? (
            <ComposerContextLabel
              loading={attachmentsInitialLoading}
              testID="composer-attachments-label"
              text={attachmentsLabel}
            />
          ) : (
            <ComposerContextCount
              label="Attachments"
              value={attachmentCount}
              testID="composer-attachments-label"
            />
          )}
        </Pressable>
      )}
    </>
  );
}
