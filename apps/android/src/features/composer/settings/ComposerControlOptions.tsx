/** V1 ComposerMenu owner, extracted without changing interaction or resource lifetime. */
import { listRowPosition } from "../../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../../ui/AppSheet";
import { ControlOption } from "../../../ui/ControlOption";
import { clampModelEffort, modelEffortLevels } from "../../../ui/modelEffort";
import { modelEffortLabel } from "../../../ui/modelEffortPresentation";
import { ModelPickerOptions } from "../../../ui/ModelPickerOptions";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "../ComposerMenu.styles";
import type { PermissionDefaultOption } from "../../../ui/TurnControlMenus.types";
import { permissionProfileLabel } from "../settings";
import { selectedPermissionProfile } from "./composerControlsView";

import type { ComposerControlOptionsProps } from "./controlOptionsContract";

export function ComposerControlOptions({
  controls,
  onSelectEffort,
  onSelectModel,
  onSelectPermissions,
  onSelectPersonality,
  page,
  selectedPersonality,
  view,
}: ComposerControlOptionsProps) {
  const selectedModel = view.model.value;
  const selectedEffort = view.effort.value;
  const selectedPermissions = selectedPermissionProfile(view.permissions.value);
  const model = view.modelEntry;
  const reasoningEfforts = model === undefined ? [] : modelEffortLevels(model);

  return (
    <AppSheetScrollView
      contentContainerStyle={styles.menuScrollContent}
      key={page}
      keyboardShouldPersistTaps="handled"
      style={styles.menuScroll}
    >
      {page === "model" && (
        <>
          <Text style={styles.controlSectionLabel}>Model</Text>
          {controls.models.length === 0 ? (
            <Text style={styles.menuNotice}>No models returned by the server</Text>
          ) : (
            <ModelPickerOptions
              models={controls.models}
              onSelect={(candidate) => {
                onSelectModel(candidate.id, clampModelEffort(candidate, selectedEffort));
              }}
              selectedModel={selectedModel}
            />
          )}
          {reasoningEfforts.length > 0 && (
            <>
              <Text style={styles.controlSectionLabel}>Thinking</Text>
              {reasoningEfforts.map((effort, index) => (
                <ControlOption
                  key={effort}
                  onPress={() => {
                    onSelectEffort(effort);
                  }}
                  position={listRowPosition(index, reasoningEfforts.length)}
                  selected={effort === selectedEffort}
                  title={modelEffortLabel(effort)}
                />
              ))}
            </>
          )}
          {model?.supportsPersonality === true && (
            <>
              <Text style={styles.controlSectionLabel}>Personality</Text>
              <ControlOption
                onPress={() => {
                  onSelectPersonality(null);
                }}
                position="first"
                selected={selectedPersonality === null}
                title="Server default"
              />
              {(["friendly", "pragmatic", "none"] as const).map((personality, index) => (
                <ControlOption
                  key={personality}
                  onPress={() => {
                    onSelectPersonality(personality);
                  }}
                  position={listRowPosition(index + 1, 4)}
                  selected={personality === selectedPersonality}
                  title={personality}
                />
              ))}
            </>
          )}
        </>
      )}
      {page === "permissions" && (
        <>
          <ControlOption
            disabled={view.permissionDefault.kind === "unavailable"}
            onPress={() => {
              const option = view.permissionDefault;
              if (option.kind === "draft") {
                onSelectPermissions(null);
              } else if (option.kind === "reset") {
                onSelectPermissions(option.resolved);
              }
            }}
            position={controls.permissions.length === 0 ? "only" : "first"}
            selected={view.permissionDefault.kind === "draft" && view.permissionDefault.selected}
            subtitle={serverDefaultSubtitle(view.permissionDefault)}
            title="Server default"
          />
          {controls.permissions.map((permission, index) => (
            <ControlOption
              disabled={!permission.allowed}
              key={permission.id}
              onPress={() => {
                onSelectPermissions(permission.id);
              }}
              position={listRowPosition(index + 1, controls.permissions.length + 1)}
              selected={permission.id === selectedPermissions}
              subtitle={
                permission.description === null
                  ? permission.id
                  : `${permission.description} · ${permission.id}`
              }
              title={permissionProfileLabel(permission.id)}
            />
          ))}
        </>
      )}
    </AppSheetScrollView>
  );
}

function serverDefaultSubtitle(option: PermissionDefaultOption): string {
  if (option.kind === "unavailable") {
    return "The server's default access is unknown";
  }
  if (option.kind === "reset") {
    return `Reset to ${permissionProfileLabel(option.resolved)}`;
  }
  return option.resolved === null
    ? "Use the server's configured access level"
    : `Use the server's configured access level · ${permissionProfileLabel(option.resolved)}`;
}
