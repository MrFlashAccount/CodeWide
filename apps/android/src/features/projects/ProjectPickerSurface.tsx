import { LayoutAnimationConfig } from "react-native-reanimated";
import { useEvent } from "../../react/useEvent";
import { AppSheet } from "../../ui/AppSheet";
import { SheetPageTransition } from "../../ui/sheetNavigation";
import type { ScopedProjectPickerProps } from "./projectPickerContract";
import { ProjectPickerFooter } from "./ProjectPickerFooter";
import { ProjectPickerSearch } from "./ProjectPickerSearch";

import { ProjectPickerContent } from "./ProjectPickerContent";
import { ProjectPickerHeader } from "./ProjectPickerHeader";
import { useProjectPickerSession, type ProjectPickerSession } from "./projectPickerSession";

function ProjectPickerPage({
  onBack,
  props,
  state,
}: {
  readonly onBack: () => void;
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const { mode, navigationDirection } = state;
  return (
    <SheetPageTransition direction={navigationDirection} routeKey={mode}>
      <ProjectPickerHeader onBack={onBack} props={props} state={state} />
      <ProjectPickerSearch state={state} />

      <ProjectPickerContent props={props} state={state} />

      <ProjectPickerFooter props={props} state={state} />
    </SheetPageTransition>
  );
}

/** Shared project and folder sheet; adapters qualify every selection with its server. */
export function ProjectPickerSurface(props: ScopedProjectPickerProps): React.JSX.Element {
  return (
    <LayoutAnimationConfig skipExiting>
      {/* The sheet owns dismissal; page exits run only while navigating inside it. */}
      <ProjectPickerSessionSheet key={props.visible ? "open" : "closed"} {...props} />
    </LayoutAnimationConfig>
  );
}

function ProjectPickerSessionSheet(props: ScopedProjectPickerProps) {
  const state = useProjectPickerSession(props);
  const { browseOnly = false, onClose, visible } = props;
  const { mode, navigate, parentPath, showProjects, showServers } = state;
  const changeOpen = useEvent((open: boolean) => {
    if (!open && visible && state.isCurrent()) {
      onClose();
    }
  });
  const backFromDirectory = useEvent(() => {
    if (mode === "directory") {
      if (parentPath !== null) {
        navigate(parentPath);
      } else {
        showServers();
      }
      return;
    }
    if (browseOnly) {
      onClose();
    } else {
      showProjects();
    }
  });

  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close project picker",
        enableDynamicSizing: false,
        enableOverDrag: false,
        enablePanDownToClose: !props.busy && !state.adding,
        index: 0,
        performanceSurface: mode === "projects" ? "projects" : "folders",
        snapPoints: ["62%", "92%"],
      }}
      isOpen={visible}
      {...(mode !== "projects" ? { onDismissRequest: backFromDirectory } : {})}
      onOpenChange={changeOpen}
    >
      <ProjectPickerPage onBack={backFromDirectory} props={props} state={state} />
    </AppSheet>
  );
}
