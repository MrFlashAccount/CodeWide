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
  attachments: MutableRefObject<ComposerLatestValue<Attachment>>;
  draft: MutableRefObject<ComposerLatestValue<Draft>>;
  preferences: MutableRefObject<ComposerLatestValue<Preferences>>;
} {
  const latestDraftRef = useConversationRef(scope, () => ({
    latest: draft,
    rendered: draft,
    scope,
  }));
  const latestAttachmentsRef = useConversationRef(scope, () => ({
    latest: attachments,
    rendered: attachments,
    scope,
  }));
  const latestPreferencesRef = useConversationRef(scope, () => ({
    latest: preferences,
    rendered: preferences,
    scope,
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
    attachments: latestAttachmentsRef,
    draft: latestDraftRef,
    preferences: latestPreferencesRef,
  };
}
