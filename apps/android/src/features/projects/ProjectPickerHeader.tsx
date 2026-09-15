import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native/button";
import { ScrollView, View } from "react-native";
import { directoryCrumbs } from "../../data/remote-projects";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { ProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { styles } from "./ProjectPickerSheet.styles";

export function ProjectPickerHeader({
  props,
  state,
}: {
  props: ProjectPickerProps;
  state: ProjectPickerSession;
}) {
  const {
    projects,
    onAddProject,
    onReadDirectory,
    onReadHomeDirectory,
    onClose,
    browseOnly = false,
    onManageProjects,
  } = props;
  const {
    mode,
    setMode,
    setQuery,
    adding,
    breadcrumbScroll,
    scrollToCurrentFolder,
    home,
    directoryPath,
    unpinnedProjects,
    parentPath,
    navigate,
    openDirectoryPicker,
  } = state;
  return (
    <>
      <View style={styles.header}>
        {mode === "directory" ? (
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            accessibilityLabel="Back to projects"
            onPress={() => {
              if (browseOnly) onClose();
              else {
                setMode("projects");
                setQuery("");
              }
            }}
          >
            <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
          </Button>
        ) : null}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{mode === "projects" ? "Choose project" : "Add project"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {mode === "projects"
              ? `${projects.length} pinned · ${unpinnedProjects.length} from history`
              : "Choose a folder on this server"}
          </Text>
        </View>
        {mode === "projects" && onManageProjects !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            accessibilityLabel="Manage Projects"
            onPress={onManageProjects}
          >
            Manage Projects
          </Button>
        ) : null}
        {mode === "projects" &&
        onManageProjects === undefined &&
        onReadDirectory !== undefined &&
        onAddProject !== undefined ? (
          <Button
            size="sm"
            variant="secondary"
            isIconOnly
            accessibilityLabel="Add project"
            onPress={openDirectoryPicker}
          >
            <Ionicons name="add" size={iconSize.navigation} color={colors.text} />
          </Button>
        ) : null}
      </View>

      {mode === "directory" ? (
        <View style={styles.pathPanel}>
          <View style={styles.pathActions}>
            {onReadHomeDirectory !== undefined ? (
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                accessibilityLabel="Home directory"
                isDisabled={adding}
                onPress={() => navigate(null)}
              >
                <Ionicons name="home-outline" size={iconSize.action} color={colors.textMuted} />
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              accessibilityLabel="Parent directory"
              isDisabled={parentPath === null || adding}
              onPress={() => {
                if (parentPath !== null) navigate(parentPath);
              }}
            >
              <Ionicons
                name="arrow-up"
                size={iconSize.action}
                color={parentPath === null ? colors.textDim : colors.text}
              />
            </Button>
            <ScrollView
              ref={breadcrumbScroll}
              onContentSizeChange={scrollToCurrentFolder}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.breadcrumbViewport}
              contentContainerStyle={styles.breadcrumbs}
            >
              {directoryCrumbs(directoryPath, home.value).map((crumb, index, crumbs) => (
                <View key={crumb.path} style={styles.crumbGroup}>
                  {index > 0 ? (
                    <Ionicons
                      name="chevron-forward"
                      size={iconSize.inline}
                      color={colors.textDim}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    accessibilityLabel={`Open directory ${crumb.path}`}
                    isDisabled={adding}
                    onPress={() => navigate(crumb.path)}
                    style={styles.crumbButton}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.crumbText, index === crumbs.length - 1 && styles.currentCrumb]}
                    >
                      {crumb.label}
                    </Text>
                  </Button>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </>
  );
}
