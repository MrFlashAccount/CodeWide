import { router } from "expo-router";
import type { V2QueryResult } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import {
  PresentationSheetView,
  type PresentationSheetContentProps,
} from "../../presentation/surfaces/PresentationSheetView";
import { useEvent } from "../../../react/useEvent";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";
import { AttachmentList } from "./AttachmentList";

interface AttachmentsScreenProps {
  owner: QualifiedThread;
}

type ThreadResourcesResult = Extract<V2QueryResult, { kind: "thread.resources" }>;

export function AttachmentsScreen(props: AttachmentsScreenProps): React.JSX.Element {
  const { owner } = props;
  const close = useEvent(() => router.back());
  const changeOpen = useEvent((open: boolean) => {
    if (!open) close();
  });
  // This callback is invoked during render, so useEvent intentionally cannot own it.
  const renderResources = (
    result: ThreadResourcesResult,
    refresh: () => Promise<void>,
  ): React.ReactNode => {
    return (
      <AttachmentList
        attachments={result.attachments}
        onClose={close}
        onRefresh={refresh}
        owner={owner}
      />
    );
  };
  return (
    <PresentationSheetView contentProps={RESOURCE_SHEET_PROPS} isOpen onOpenChange={changeOpen}>
      <V2QueryBoundary
        chrome="none"
        query={{
          cursor: null,
          kind: "thread.resources",
          limit: 100,
          scope: "session",
          threadId: owner.threadId,
        }}
        savedServerId={owner.savedServerId}
        title="Attachments"
      >
        {renderResources}
      </V2QueryBoundary>
    </PresentationSheetView>
  );
}

const RESOURCE_SHEET_PROPS: PresentationSheetContentProps = {
  contentContainerClassName: "h-full",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};
