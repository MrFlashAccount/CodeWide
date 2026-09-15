/** V1 ComposerMenu owner, extracted without changing interaction or resource lifetime. */
import { listRowPosition } from "../../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../../ui/AppSheet";
import { ControlOption } from "../../../ui/ControlOption";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "../ComposerMenu.styles";
import { permissionProfileLabel } from "../settings";

import type { ComposerControlOptionsProps } from "./controlOptionsContract";
export function ComposerControlOptions({
  page,
  controls,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
  onSelectPermissions,
}: ComposerControlOptionsProps) {
  const model = controls.models.find((candidate) => candidate.id === selectedModel);
  const reasoningEfforts =
    model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];

  return (
    <AppSheetScrollView
      key={page}
      style={styles.menuScroll}
      contentContainerStyle={styles.menuScrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {page === "model" && (
        <>
          <Text style={styles.controlSectionLabel}>Model</Text>
          {controls.models.length === 0 ? (
            <Text style={styles.menuNotice}>No models returned by the server</Text>
          ) : (
            controls.models.map((candidate, index) => {
              const currentEffort =
                selectedEffort ?? model?.defaultEffort ?? candidate.defaultEffort;
              const nextEffort = candidate.efforts.includes(currentEffort)
                ? currentEffort
                : candidate.defaultEffort;
              return (
                <ControlOption
                  key={candidate.id}
                  position={listRowPosition(index, controls.models.length)}
                  title={candidate.label}
                  subtitle={candidate.id}
                  selected={candidate.id === selectedModel}
                  onPress={() => onSelectModel(candidate.id, nextEffort)}
                />
              );
            })
          )}
          {model !== undefined && (
            <>
              <Text style={styles.controlSectionLabel}>Thinking</Text>
              {reasoningEfforts.map((effort, index) => (
                <ControlOption
                  key={effort}
                  position={listRowPosition(index, reasoningEfforts.length)}
                  title={effort}
                  selected={effort === selectedEffort}
                  onPress={() => onSelectEffort(effort)}
                />
              ))}
            </>
          )}
          {model?.supportsPersonality === true && (
            <>
              <Text style={styles.controlSectionLabel}>Personality</Text>
              <ControlOption
                position="first"
                title="Server default"
                selected={selectedPersonality === null}
                onPress={() => onSelectPersonality(null)}
              />
              {(["friendly", "pragmatic", "none"] as const).map((personality, index) => (
                <ControlOption
                  position={listRowPosition(index + 1, 4)}
                  key={personality}
                  title={personality}
                  selected={personality === selectedPersonality}
                  onPress={() => onSelectPersonality(personality)}
                />
              ))}
            </>
          )}
        </>
      )}
      {page === "permissions" && (
        <>
          <ControlOption
            position={controls.permissions.length === 0 ? "only" : "first"}
            title="Server default"
            selected={selectedPermissions === null}
            onPress={() => onSelectPermissions(null)}
          />
          {controls.permissions.map((permission, index) => (
            <ControlOption
              key={permission.id}
              position={listRowPosition(index + 1, controls.permissions.length + 1)}
              title={permissionProfileLabel(permission.id)}
              subtitle={
                permission.description === null
                  ? permission.id
                  : `${permission.description} · ${permission.id}`
              }
              selected={permission.id === selectedPermissions}
              disabled={!permission.allowed}
              onPress={() => onSelectPermissions(permission.id)}
            />
          ))}
        </>
      )}
    </AppSheetScrollView>
  );
}
