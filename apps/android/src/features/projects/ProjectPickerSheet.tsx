import { AppButton as Button } from "../../presentation/controls/AppButton";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors, controlHitSlop, iconSize } from "../../theme";
import { AppSheet } from "../../ui/AppSheet";
import { SheetPageTransition } from "../../ui/sheetNavigation";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import type { ProjectPickerProps } from "./projectPickerContract";
import { styles } from "./ProjectPickerSheet.styles";

import { ProjectPickerContent } from "./ProjectPickerContent";
import { ProjectPickerHeader } from "./ProjectPickerHeader";
import { useProjectPickerSession } from "./projectPickerSession";

export function ProjectPickerSheet(props: ProjectPickerProps) {
  return <ProjectPickerSessionSheet key={props.visible ? "open" : "closed"} {...props} />;
}

function ProjectPickerSessionSheet(props: ProjectPickerProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const state = useProjectPickerSession(props);
  const { browseOnly = false, busy, error, onClose, visible } = props;
  const {
    addCurrentDirectory,
    adding,
    directory,
    directoryError,
    directoryLoading,
    mode,
    navigationDirection,
    projectActionError,
    query,
    readError,
    setQuery,
    showProjects,
  } = state;
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      onClose();
    }
  });
  const clearQuery = useEvent(() => {
    setQuery("");
  });
  const focusSearch = useEvent(() => {
    setSearchFocused(true);
  });
  const blurSearch = useEvent(() => {
    setSearchFocused(false);
  });
  const backFromDirectory = useEvent(() => {
    if (browseOnly) {
      onClose();
      return;
    }
    showProjects();
    setQuery("");
  });

  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close project picker",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        performanceSurface: mode === "projects" ? "projects" : "folders",
        snapPoints: ["62%", "92%"],
      }}
      isOpen={visible}
      {...(mode === "directory" && !browseOnly ? { onDismissRequest: backFromDirectory } : {})}
      onOpenChange={changeOpen}
    >
      <SheetPageTransition direction={navigationDirection} routeKey={mode}>
        <ProjectPickerHeader onBack={backFromDirectory} props={props} state={state} />
        <View style={[styles.searchField, searchFocused ? styles.searchFieldFocused : undefined]}>
          <Ionicons
            color={colors.textMuted}
            name="search"
            pointerEvents="none"
            size={iconSize.inline}
            style={styles.searchIcon}
          />
          <TextInput
            accessibilityLabel="Search"
            accessibilityRole="search"
            onBlur={blurSearch}
            onChangeText={setQuery}
            onFocus={focusSearch}
            placeholder={mode === "projects" ? "Search projects" : "Filter folders"}
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
            value={query}
            voiceInput={false}
          />
          {query === "" ? null : (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={controlHitSlop.compact}
              onPress={clearQuery}
              style={styles.searchClear}
            >
              <Ionicons color={colors.textMuted} name="close" size={14} />
            </Pressable>
          )}
        </View>

        <ProjectPickerContent props={props} state={state} />

        {mode === "directory" ? (
          <View style={styles.footer}>
            {directoryError !== null ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {directoryError}
              </Text>
            ) : null}
            <Button
              isDisabled={
                busy ||
                adding ||
                directoryLoading ||
                readError !== null ||
                directory.status !== "ready"
              }
              onPress={addCurrentDirectory}
              variant="primary"
            >
              {adding ? "Adding project…" : browseOnly ? "Add this folder" : "Use this folder"}
            </Button>
          </View>
        ) : (
          <View style={styles.footerStatus}>
            {busy ? <ActivityIndicator color={colors.accent} size="small" /> : null}
            {busy ? <Text style={styles.stateText}>Switching project…</Text> : null}
            {projectActionError !== null ? (
              <Text style={styles.errorText}>{projectActionError}</Text>
            ) : null}
            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}
      </SheetPageTransition>
    </AppSheet>
  );
}
