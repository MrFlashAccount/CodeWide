/** V1 ThreadResourceContextChips owner, extracted without changing interaction or resource lifetime. */
import { Pressable } from "react-native";
import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import { useThreadResources } from "../../data/use-thread-resources";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import { changeScopeMenuActions, changeScopeTitle } from "../../rendering/change-menu";
import { colors } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount, ComposerContextLabel } from "../../ui/ResourceContextChip";
import type { ChangesPreferences } from "./changePresentation";
import { styles } from "./ThreadResourceContextChips.styles";

export function ThreadResourceContextChips({
  load,
  model,
  onOpen,
  onPreferencesChange,
  preferences,
  resourceId,
  revision,
}: {
  load: (
    scope?: ThreadChangeScope,
    kind?: "all" | "changes" | "attachments",
  ) => Promise<ThreadResourcesValue>;
  model: ThreadResourcesModel | null;
  onOpen: (kind: "changes" | "attachments") => void;
  onPreferencesChange: (preferences: ChangesPreferences) => void;
  preferences: ChangesPreferences;
  resourceId: string | null;
  revision: string;
}) {
  const dialog = useAppDialog();
  const resource = useThreadResources(model, resourceId, async () => load(), { revision });
  const pending = (kind: "changes" | "attachments") =>
    resource === null ||
    (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes(kind));
  const ready = (kind: "changes" | "attachments") =>
    resource?.readyKinds === undefined
      ? resource?.value !== null && resource?.value !== undefined
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
        : `Changes · ${String(changeCount)}`;
  const attachmentsLabel = attachmentsInitialLoading
    ? "Loading attachments…"
    : attachmentsUnavailable
      ? "Attachments unavailable"
      : attachmentsEmpty
        ? "No attachments"
        : `Attachments · ${String(attachmentCount)}`;
  const selectScope = (id: string) => {
    if (!id.startsWith("scope:")) {
      return;
    }
    const scope = threadChangeScope(id.slice("scope:".length));
    if (scope === null || !changeScopes.includes(scope)) {
      return;
    }
    onPreferencesChange({ ...preferences, scope });
    void load(scope, "changes").catch((error: unknown) => {
      dialog.alert(
        "Changes unavailable",
        error instanceof Error ? error.message : "Could not load changes",
      );
    });
  };
  return (
    <>
      {!changesUnavailable && (
        <ActionMenu
          accessibilityLabel="Choose changes scope"
          actions={changeScopeMenuActions(changeScopes, changeScope)}
          align="start"
          onSelect={selectScope}
          placement="top"
          trigger="long-press"
        >
          <Pressable
            accessibilityLabel={`${changesLabel}, ${changeScopeTitle(changeScope)}. Long press to choose changes scope.`}
            accessibilityRole="button"
            onPress={() => {
              onOpen("changes");
            }}
            style={styles.composerContextChip}
          >
            <InlineIcon
              color={changesEmpty ? colors.textDim : colors.textMuted}
              name="git-compare-outline"
              role="label"
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
                testID="composer-changes-label"
                value={changeCount}
              />
            )}
          </Pressable>
        </ActionMenu>
      )}
      {!attachmentsUnavailable && (
        <Pressable
          accessibilityLabel={attachmentsLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: attachmentsEmpty }}
          disabled={attachmentsEmpty}
          onPress={() => {
            onOpen("attachments");
          }}
          style={[styles.composerContextChip, attachmentsEmpty && styles.disabled]}
        >
          <InlineIcon
            color={attachmentsEmpty ? colors.textDim : colors.textMuted}
            name="attach-outline"
            role="label"
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
              testID="composer-attachments-label"
              value={attachmentCount}
            />
          )}
        </Pressable>
      )}
    </>
  );
}

function threadChangeScope(value: string): ThreadChangeScope | null {
  switch (value) {
    case "session":
    case "lastTurn":
    case "staged":
    case "unstaged":
    case "branch":
      return value;
    default:
      return null;
  }
}
