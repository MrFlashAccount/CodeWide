import { useLayoutEffect, type MutableRefObject } from "react";
import { useConversationRef } from "../../ui/use-conversation-scope";

import {
  reconcileComposerLatestValue,
  type ComposerLatestValue,
} from "../../data/composer-latest-value";

/**
 * Bridges optimistic composer commands with their asynchronously projected
 * durable row. The refs are concurrency guards, not rendered state: a stale
 * projection must not overwrite newer input while SQLite acknowledges it.
 */
export function useComposerLatestValues<Draft, Attachment, Preferences>(
  scope: string,
  draft: Draft,
  attachments: Attachment,
  preferences: Preferences,
): {
  draft: MutableRefObject<ComposerLatestValue<Draft>>;
  attachments: MutableRefObject<ComposerLatestValue<Attachment>>;
  preferences: MutableRefObject<ComposerLatestValue<Preferences>>;
} {
  const latestDraftRef = useConversationRef(scope, () => ({
    scope,
    rendered: draft,
    latest: draft,
  }));
  const latestAttachmentsRef = useConversationRef(scope, () => ({
    scope,
    rendered: attachments,
    latest: attachments,
  }));
  const latestPreferencesRef = useConversationRef(scope, () => ({
    scope,
    rendered: preferences,
    latest: preferences,
  }));
  useLayoutEffect(() => {
    latestDraftRef.current = reconcileComposerLatestValue(latestDraftRef.current, scope, draft);
    latestAttachmentsRef.current = reconcileComposerLatestValue(
      latestAttachmentsRef.current,
      scope,
      attachments,
    );
    latestPreferencesRef.current = reconcileComposerLatestValue(
      latestPreferencesRef.current,
      scope,
      preferences,
    );
  }, [
    attachments,
    draft,
    preferences,
    scope,
    latestDraftRef,
    latestAttachmentsRef,
    latestPreferencesRef,
  ]);
  return {
    draft: latestDraftRef,
    attachments: latestAttachmentsRef,
    preferences: latestPreferencesRef,
  };
}
