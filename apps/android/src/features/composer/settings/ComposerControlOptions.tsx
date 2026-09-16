/** V1 ComposerMenu owner, extracted without changing interaction or resource lifetime. */
import { listRowPosition } from "../../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../../ui/AppSheet";
import { ControlOption } from "../../../ui/ControlOption";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "../ComposerMenu.styles";
import { permissionProfileLabel } from "../settings";

import type { ComposerControlOptionsProps } from "./controlOptionsContract";

export function ComposerControlOptions({
  controls,
  onSelectEffort,
  onSelectModel,
  onSelectPermissions,
  onSelectPersonality,
  page,
  selectedEffort,
  selectedModel,
  selectedPermissions,
  selectedPersonality,
}: ComposerControlOptionsProps) {
  const model = controls.models.find((candidate) => candidate.id === selectedModel);
  const reasoningEfforts =
    model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];

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
            controls.models.map((candidate, index) => {
              const currentEffort =
                selectedEffort ?? model?.defaultEffort ?? candidate.defaultEffort;
              const nextEffort = candidate.efforts.includes(currentEffort)
                ? currentEffort
                : candidate.defaultEffort;
              return (
                <ControlOption
                  key={candidate.id}
                  onPress={() => {
                    onSelectModel(candidate.id, nextEffort);
                  }}
                  position={listRowPosition(index, controls.models.length)}
                  selected={candidate.id === selectedModel}
                  subtitle={candidate.id}
                  title={candidate.label}
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
                  onPress={() => {
                    onSelectEffort(effort);
                  }}
                  position={listRowPosition(index, reasoningEfforts.length)}
                  selected={effort === selectedEffort}
                  title={effort}
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
            onPress={() => {
              onSelectPermissions(null);
            }}
            position={controls.permissions.length === 0 ? "only" : "first"}
            selected={selectedPermissions === null}
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
