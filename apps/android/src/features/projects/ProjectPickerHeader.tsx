import { Ionicons } from "@expo/vector-icons";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { ScrollView, View } from "react-native";
import { directoryCrumbs } from "../../data/remote-projects";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { ProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { styles } from "./ProjectPickerSheet.styles";

export function ProjectPickerHeader({
  onBack,
  props,
  state,
}: {
  onBack: () => void;
  props: ProjectPickerProps;
  state: ProjectPickerSession;
}) {
  const { onAddProject, onManageProjects, onReadDirectory, onReadHomeDirectory, projects } = props;
  const {
    adding,
    breadcrumbScroll,
    directoryPath,
    home,
    mode,
    navigate,
    openDirectoryPicker,
    parentPath,
    scrollToCurrentFolder,
    unpinnedProjects,
  } = state;
  return (
    <>
      <View style={styles.header}>
        {mode === "directory" ? (
          <Button
            accessibilityLabel="Back to projects"
            isIconOnly
            onPress={onBack}
            size="sm"
            variant="ghost"
          >
            <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
          </Button>
        ) : null}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{mode === "projects" ? "Choose project" : "Add project"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {mode === "projects"
              ? `${String(projects.length)} pinned · ${String(unpinnedProjects.length)} from history`
              : "Choose a folder on this server"}
          </Text>
        </View>
        {mode === "projects" && onManageProjects !== undefined ? (
          <Button
            accessibilityLabel="Manage Projects"
            onPress={onManageProjects}
            size="sm"
            variant="ghost"
          >
            Manage Projects
          </Button>
        ) : null}
        {mode === "projects" &&
        onManageProjects === undefined &&
        onReadDirectory !== undefined &&
        onAddProject !== undefined ? (
          <Button
            accessibilityLabel="Add project"
            isIconOnly
            onPress={openDirectoryPicker}
            size="sm"
            variant="secondary"
          >
            <Ionicons color={colors.text} name="add" size={iconSize.navigation} />
          </Button>
        ) : null}
      </View>

      {mode === "directory" ? (
        <View style={styles.pathPanel}>
          <View style={styles.pathActions}>
            {onReadHomeDirectory !== undefined ? (
              <Button
                accessibilityLabel="Home directory"
                isDisabled={adding}
                isIconOnly
                onPress={() => {
                  navigate(null);
                }}
                size="sm"
                variant="ghost"
              >
                <Ionicons color={colors.textMuted} name="home-outline" size={iconSize.action} />
              </Button>
            ) : null}
            <Button
              accessibilityLabel="Parent directory"
              isDisabled={parentPath === null || adding}
              isIconOnly
              onPress={() => {
                if (parentPath !== null) {
                  navigate(parentPath);
                }
              }}
              size="sm"
              variant="ghost"
            >
              <Ionicons
                color={parentPath === null ? colors.textDim : colors.text}
                name="arrow-up"
                size={iconSize.action}
              />
            </Button>
            <ScrollView
              contentContainerStyle={styles.breadcrumbs}
              horizontal
              onContentSizeChange={scrollToCurrentFolder}
              ref={breadcrumbScroll}
              showsHorizontalScrollIndicator={false}
              style={styles.breadcrumbViewport}
            >
              {directoryCrumbs(directoryPath, home.value).map((crumb, index, crumbs) => (
                <View key={crumb.path} style={styles.crumbGroup}>
                  {index > 0 ? (
                    <Ionicons
                      color={colors.textDim}
                      name="chevron-forward"
                      size={iconSize.inline}
                    />
                  ) : null}
                  <Button
                    accessibilityLabel={`Open directory ${crumb.path}`}
                    isDisabled={adding}
                    onPress={() => {
                      navigate(crumb.path);
                    }}
                    size="sm"
                    style={styles.crumbButton}
                    variant="ghost"
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
