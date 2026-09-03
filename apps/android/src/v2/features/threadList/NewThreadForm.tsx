import type { SyncV2SessionSnapshot } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import { ObservableResource } from "../../application/resources/resource";
import type { SavedServerId } from "../../domain/ids";
import { DrawingWorkspace } from "../drawing/DrawingWorkspace";
import { SkillsSheet } from "../skills/SkillsSheet";
import { NewThreadView } from "./NewThreadView";
import type {
  NewThreadComposerAction,
  NewThreadComposerActionContext,
} from "./newThreadComposerActions";
import { useNewThreadComposerModel } from "./useNewThreadComposerModel";

const EMPTY_PROJECTION_RESOURCE = new ObservableResource<SyncV2SessionSnapshot>({
  operations: [],
  projections: { live: null, retained: null },
  state: "offline",
  version: 0,
});
export type { NewThreadComposerAction };

export interface NewThreadFormProps {
  onBack(): void;
  onComposerAction?(
    action: NewThreadComposerAction,
    context: NewThreadComposerActionContext,
  ): void | Promise<void>;
  onThreadCreated(threadId: string): void;
  savedServerId: SavedServerId;
}

interface NewThreadComposerProps extends NewThreadFormProps {
  modelOpeningError: string | null;
  modelResource: QueryResourceHandle | null;
  projectOpeningError: string | null;
  projectResource: QueryResourceHandle | null;
  projectionOpeningError: string | null;
  projectionResource: ProjectionResource | null;
}

export function NewThreadForm(props: NewThreadFormProps): React.JSX.Element {
  return <NewThreadFormForServer key={props.savedServerId} {...props} />;
}

function NewThreadFormForServer(props: NewThreadFormProps): React.JSX.Element {
  const { onBack, onComposerAction, onThreadCreated, savedServerId } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.query(savedServerId, { kind: "projects.list" }));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const [modelOuter] = useState(() => runtime.query(savedServerId, { kind: "models.list" }));
  const modelsOpened = useSyncExternalStore(
    modelOuter.subscribe,
    modelOuter.snapshot,
    modelOuter.snapshot,
  );
  const [projectionOuter] = useState(() => runtime.projection(savedServerId));
  const projectionOpened = useSyncExternalStore(
    projectionOuter.subscribe,
    projectionOuter.snapshot,
    projectionOuter.snapshot,
  );
  return (
    <NewThreadComposer
      modelOpeningError={modelsOpened.status === "error" ? modelsOpened.message : null}
      modelResource={modelsOpened.value}
      onBack={onBack}
      {...(onComposerAction === undefined ? {} : { onComposerAction })}
      onThreadCreated={onThreadCreated}
      projectOpeningError={opened.status === "error" ? opened.message : null}
      projectResource={opened.value}
      projectionOpeningError={projectionOpened.status === "error" ? projectionOpened.message : null}
      projectionResource={projectionOpened.value}
      savedServerId={savedServerId}
    />
  );
}

function NewThreadComposer(props: NewThreadComposerProps): React.JSX.Element {
  const {
    modelOpeningError,
    modelResource,
    onBack,
    onComposerAction,
    onThreadCreated,
    projectOpeningError,
    projectResource,
    projectionOpeningError,
    projectionResource,
    savedServerId,
  } = props;
  const projection = projectionResource ?? EMPTY_PROJECTION_RESOURCE;
  const model = useNewThreadComposerModel({
    modelOpeningError,
    modelResource,
    ...(onComposerAction === undefined ? {} : { onComposerAction }),
    onThreadCreated,
    projectOpeningError,
    projectResource,
    projectionOpeningError,
    projectionResource: projection,
    savedServerId,
  });
  if (model.drawingRequest !== null) {
    const request = model.drawingRequest;
    return (
      <DrawingWorkspace
        draft={model.attachmentDraft}
        draftItemId={request.draftItemId}
        initialSnapshot={request.initialSnapshot}
        mode={request.mode}
        {...(request.name === undefined ? {} : { name: request.name })}
        now={model.currentDate}
        onAttached={model.onDrawingAttached}
        onClose={model.closeDrawing}
      />
    );
  }
  return (
    <>
      <NewThreadView {...model.view} onBack={onBack} />
      {model.skillsVisible && model.skillsWorkspace !== null ? (
        <SkillsSheet
          onClose={model.closeSkills}
          onSelect={model.onSelectSkill}
          savedServerId={savedServerId}
          workspace={model.skillsWorkspace}
        />
      ) : null}
    </>
  );
}
