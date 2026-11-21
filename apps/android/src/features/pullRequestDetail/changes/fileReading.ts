import { observable, type ObservablePrimitive } from "@legendapp/state";
import type { DraftId } from "../../../data/reviewContract";
import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { useState } from "react";
import { useEvent } from "../../../react/useEvent";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { ExtraMenuItem } from "../actions/OverflowActionsMenu";
import type { PullRequestChangesProps } from "./changesContract";
import type { ChangesData } from "./useChangesData";
import type { DraftComposer } from "./useDraftComposer";

/** A whole-file draft pins the location at the moment the composer opens. */
export type FileCommentTarget = {
  readonly body: ObservablePrimitive<string>;
  readonly id: DraftId | null;
  readonly path: string;
  readonly revision: string;
};

/** Creates the editing buffer for one explicit new or restored comment. */
function fileCommentTarget(
  input: Omit<FileCommentTarget, "body"> & { readonly body: string },
): FileCommentTarget {
  return { ...input, body: observable(input.body) };
}

/** Navigation between the recorded patch, the complete source and the review guide. */
export function useFileReading(
  props: PullRequestChangesProps,
  data: ChangesData,
): {
  readonly actions: readonly ActionDescriptor[];
  readonly back: (() => void) | undefined;
  readonly backToFiles: () => void;
  readonly files: boolean;
  readonly sourceFile: PullRequestFile | null;
  readonly title: string;
  readonly viewSource: () => void;
} {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const sourceFile = activeSource(data, sourcePath);
  const backToFiles = useEvent(() => {
    setSourcePath(null);
    props.model.changesView.set("files");
  });
  const viewSource = useEvent(() => {
    if (data.selected !== null) {
      setSourcePath(data.selected.path);
    }
  });
  const files = sourceFile === null && data.view === "files";
  return {
    actions: props.fileActions.get(data.selected?.path ?? "") ?? [],
    back: files ? undefined : backToFiles,
    backToFiles,
    files,
    sourceFile,
    title: fileTitle(sourceFile, data.view),
    viewSource,
  };
}

function fileTitle(source: PullRequestFile | null, view: ChangesData["view"]): string {
  if (source !== null) {
    return "File";
  }
  return view === "guide" ? "Review guide" : "Files changed";
}

/** File commands offered by the selected provider. */
export function useFileMenu({
  commentOnFile,
  data,
  props,
  viewSource,
}: {
  readonly commentOnFile: () => void;
  readonly data: ChangesData;
  readonly props: PullRequestChangesProps;
  readonly viewSource: () => void;
}): ExtraMenuItem[] {
  const fileMenu: ExtraMenuItem[] = [];
  if (data.headFiles.capable && data.selected?.status !== "removed") {
    fileMenu.push({
      icon: "document-text-outline",
      id: "view-file",
      label: "View file",
      onSelect: viewSource,
    });
  }
  if (props.providerCapabilities.includes("forge.review.file@1")) {
    fileMenu.push({
      icon: "chatbox-outline",
      id: "comment-file",
      label: "Comment on file",
      onSelect: commentOnFile,
    });
  }
  const attachFile = useEvent(() => {
    if (data.selected !== null) {
      props.attachFile?.(data.selected, props.overview.headRevision);
    }
  });
  if (props.attachFile !== undefined && data.headFiles.capable && !props.offline) {
    fileMenu.push({
      icon: "attach-outline",
      id: "attach-file",
      label: "Attach to agent chat",
      onSelect: attachFile,
    });
  }
  return fileMenu;
}

/** Owns a whole-file comment until added, dismissed, or restored after a refusal. */
export function useFileComment(
  props: PullRequestChangesProps,
  data: ChangesData,
  composer: DraftComposer,
): {
  readonly closeFileComment: () => void;
  readonly commentOnFile: () => void;
  readonly fileComment: FileCommentTarget | null;
  readonly onLinePress: DraftComposer["tapLine"];
  readonly restorePut: (put: DraftPut) => void;
} {
  const [fileComment, setFileComment] = useState<FileCommentTarget | null>(null);
  const closeFileComment = useEvent(() => {
    setFileComment(null);
  });
  const commentOnFile = useEvent(() => {
    if (data.selected === null || fileComment !== null) {
      return;
    }
    composer.close();
    setFileComment(
      fileCommentTarget({
        body: "",
        id: null,
        path: data.selected.path,
        revision: props.overview.headRevision,
      }),
    );
  });
  const restorePut = useEvent((put: DraftPut) => {
    if (put.draft.anchor.kind !== "file") {
      composer.restore(put);
      return;
    }
    composer.close();
    props.reviewCapabilities.dismissDraftPut(put.operationId);
    setFileComment(
      fileCommentTarget({
        body: put.draft.body,
        id: put.draft.id,
        path: put.draft.anchor.path,
        revision: put.draft.revision.revision,
      }),
    );
  });
  return {
    closeFileComment,
    commentOnFile,
    fileComment,
    onLinePress: fileComment === null ? composer.tapLine : ignoreLine,
    restorePut,
  };
}

function ignoreLine(): void {}

/** Reading Back yields to an open comment composer. */
export function acceptReadingBack(
  back: (() => void) | undefined,
  composer: DraftComposer,
  target: FileCommentTarget | null,
): boolean {
  return back !== undefined && composer.line === null && target === null;
}

/** Floating actions yield to the active editor or narrow file chooser. */
export function canFloat({
  comment,
  line,
  pickerOpen,
  source,
}: {
  readonly comment: FileCommentTarget | null;
  readonly line: DraftComposer["line"];
  readonly pickerOpen: boolean;
  readonly source: PullRequestFile | null;
}): boolean {
  return comment === null && line === null && !pickerOpen && source === null;
}

function activeSource(data: ChangesData, sourcePath: string | null): PullRequestFile | null {
  return sourcePath !== null && data.selected?.path === sourcePath && data.view === "files"
    ? data.selected
    : null;
}
