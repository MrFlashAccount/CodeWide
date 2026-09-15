import { Button } from "heroui-native/button";
import { SearchField } from "heroui-native/search-field";
import { ActivityIndicator, View } from "react-native";
import { colors } from "../../theme";
import { AppSheet } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import type { ProjectPickerProps } from "./projectPickerContract";
import { styles } from "./ProjectPickerSheet.styles";

import { ProjectPickerContent } from "./ProjectPickerContent";
import { ProjectPickerHeader } from "./ProjectPickerHeader";
import { useProjectPickerSession } from "./projectPickerSession";
export function ProjectPickerSheet(props: ProjectPickerProps) {
  const state = useProjectPickerSession(props);
  const { visible, busy, error, onClose, browseOnly = false } = props;
  const {
    mode,
    query,
    setQuery,
    directoryError,
    adding,
    projectActionError,
    directory,
    readError,
    directoryLoading,
    addCurrentDirectory,
  } = state;

  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close project picker",
        performanceSurface: mode === "projects" ? "projects" : "folders",
        index: 0,
        snapPoints: ["62%", "92%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <ProjectPickerHeader props={props} state={state} />
      <SearchField value={query} onChange={setQuery} style={styles.searchField}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input
            placeholder={mode === "projects" ? "Search projects" : "Filter folders"}
          />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <ProjectPickerContent props={props} state={state} />

      {mode === "directory" ? (
        <View style={styles.footer}>
          {directoryError !== null ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {directoryError}
            </Text>
          ) : null}
          <Button
            variant="primary"
            isDisabled={
              busy ||
              adding ||
              directoryLoading ||
              readError !== null ||
              directory.status !== "ready"
            }
            onPress={() => void addCurrentDirectory()}
          >
            {adding ? "Adding project…" : browseOnly ? "Add this folder" : "Use this folder"}
          </Button>
        </View>
      ) : (
        <View style={styles.footerStatus}>
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          {busy ? <Text style={styles.stateText}>Switching project…</Text> : null}
          {projectActionError !== null ? (
            <Text style={styles.errorText}>{projectActionError}</Text>
          ) : null}
          {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      )}
    </AppSheet>
  );
}
