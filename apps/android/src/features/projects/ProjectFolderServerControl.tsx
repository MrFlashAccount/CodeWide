import { ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "../../presentation/controls/AppButton";
import { pathCrumbs, type PathCrumb } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppText } from "../../ui/Typography";
import { ServerIcon } from "../connections/ServerIcon";
import type { ProjectPickerServer, ScopedProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { styles } from "./ProjectPickerSheet.styles";

function ServersCrumb({
  disabled,
  onPress,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <AppButton
      accessibilityLabel="Browse servers"
      isDisabled={disabled}
      onPress={onPress}
      size="sm"
      style={styles.crumbButton}
      variant="ghost"
    >
      <AppText style={styles.crumbText}>Servers</AppText>
    </AppButton>
  );
}

function ServerCrumb({
  disabled,
  navigate,
  rootPath,
  server,
}: {
  readonly disabled: boolean;
  readonly navigate: (path: string | null) => void;
  readonly rootPath: string | null;
  readonly server: ProjectPickerServer;
}): React.JSX.Element {
  const openRoot = useEvent(() => {
    if (rootPath !== null) {
      navigate(rootPath);
    }
  });
  return (
    <View style={styles.crumbGroup}>
      <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      <AppButton
        accessibilityLabel={`Open server root: ${server.name}`}
        isDisabled={disabled || rootPath === null}
        onPress={openRoot}
        size="sm"
        style={styles.crumbButton}
        variant="ghost"
      >
        <ServerIcon iconId={server.iconId} metric="caption" />
        <AppText numberOfLines={1} style={styles.crumbText}>
          {server.name}
        </AppText>
      </AppButton>
    </View>
  );
}

function DirectoryCrumb({
  crumb,
  current,
  disabled,
  navigate,
}: {
  readonly crumb: PathCrumb;
  readonly current: boolean;
  readonly disabled: boolean;
  readonly navigate: (path: string | null) => void;
}): React.JSX.Element {
  const openDirectory = useEvent(() => {
    navigate(crumb.path);
  });
  return (
    <View style={styles.crumbGroup}>
      <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      <AppButton
        accessibilityLabel={`Open directory ${crumb.path}`}
        isDisabled={disabled}
        onPress={openDirectory}
        size="sm"
        style={styles.crumbButton}
        variant="ghost"
      >
        <AppText numberOfLines={1} style={[styles.crumbText, current && styles.currentCrumb]}>
          {crumb.label}
        </AppText>
      </AppButton>
    </View>
  );
}

/** Breadcrumbs connect the server catalogue to every ancestor of the qualified folder. */
export function ProjectFolderServerControl({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const {
    adding,
    breadcrumbScroll,
    directoryPath,
    directoryServer,
    navigate,
    scrollToCurrentFolder,
    showServers,
  } = state;
  const crumbs = pathCrumbs(directoryPath);
  const root = crumbs[0];
  return (
    <View style={styles.pathPanel}>
      <ServersCrumb disabled={props.busy || adding} onPress={showServers} />
      <ScrollView
        contentContainerStyle={styles.breadcrumbs}
        horizontal
        onContentSizeChange={scrollToCurrentFolder}
        onLayout={scrollToCurrentFolder}
        ref={breadcrumbScroll}
        showsHorizontalScrollIndicator={false}
        style={styles.breadcrumbViewport}
      >
        {directoryServer === null ? null : (
          <ServerCrumb
            disabled={props.busy || adding}
            navigate={navigate}
            rootPath={root?.path ?? null}
            server={directoryServer}
          />
        )}
        {crumbs.map((crumb, index) =>
          index === 0 && crumb.label === "/" ? null : (
            <DirectoryCrumb
              crumb={crumb}
              current={crumb.path === directoryPath}
              disabled={props.busy || adding}
              key={crumb.path}
              navigate={navigate}
            />
          ),
        )}
      </ScrollView>
    </View>
  );
}
