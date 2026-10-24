import { LayoutAnimationConfig } from "react-native-reanimated";
import { useEvent } from "../../react/useEvent";
import { AppSheet } from "../../ui/AppSheet";
import { AppRouteSheet } from "../../ui/AppRouteSheet";
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
  sheetScroll,
  state,
}: {
  readonly onBack: () => void;
  readonly props: ScopedProjectPickerProps;
  readonly sheetScroll: boolean;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const { mode, navigationDirection } = state;
  return (
    <SheetPageTransition direction={navigationDirection} routeKey={mode}>
      <ProjectPickerHeader onBack={onBack} props={props} state={state} />
      <ProjectPickerSearch state={state} />

      <ProjectPickerContent props={props} sheetScroll={sheetScroll} state={state} />

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

/** Route-owned project picker; the Router modal is the only presentation lifecycle. */
export function ProjectPickerRouteSurface(props: ScopedProjectPickerProps): React.JSX.Element {
  const state = useProjectPickerSession(props);
  const back = useProjectPickerBack(props, state);
  return (
    <LayoutAnimationConfig skipExiting>
      <AppRouteSheet dismissLabel="Close project picker" onDismiss={props.onClose}>
        <ProjectPickerPage onBack={back} props={props} sheetScroll={false} state={state} />
      </AppRouteSheet>
    </LayoutAnimationConfig>
  );
}

function ProjectPickerSessionSheet(props: ScopedProjectPickerProps) {
  const state = useProjectPickerSession(props);
  const { onClose, visible } = props;
  const changeOpen = useEvent((open: boolean) => {
    if (!open && visible && state.isCurrent()) {
      onClose();
    }
  });
  const backFromDirectory = useProjectPickerBack(props, state);

  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close project picker",
        enableDynamicSizing: false,
        enableOverDrag: false,
        enablePanDownToClose: !props.busy && !state.adding,
        index: 0,
        performanceSurface: state.mode === "projects" ? "projects" : "folders",
        snapPoints: ["62%", "92%"],
      }}
      isOpen={visible}
      {...(state.mode !== "projects" ? { onDismissRequest: backFromDirectory } : {})}
      onOpenChange={changeOpen}
    >
      <ProjectPickerPage onBack={backFromDirectory} props={props} sheetScroll state={state} />
    </AppSheet>
  );
}

function useProjectPickerBack(
  props: ScopedProjectPickerProps,
  state: ProjectPickerSession,
): () => void {
  return useEvent(() => {
    const { mode, navigate, parentPath, showProjects, showServers } = state;
    if (mode === "directory") {
      if (parentPath !== null) {
        navigate(parentPath);
      } else {
        showServers();
      }
      return;
    }
    if (props.browseOnly === true) {
      props.onClose();
    } else {
      showProjects();
    }
  });
}
