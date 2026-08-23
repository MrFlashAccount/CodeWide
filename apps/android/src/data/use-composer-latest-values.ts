import { useLayoutEffect, useRef, type MutableRefObject } from "react";

import { reconcileComposerLatestValue, type ComposerLatestValue } from "./composer-latest-value";

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
  const latestDraft = useRef<ComposerLatestValue<Draft>>({ scope, rendered: draft, latest: draft });
  const latestAttachments = useRef<ComposerLatestValue<Attachment>>({ scope, rendered: attachments, latest: attachments });
  const latestPreferences = useRef<ComposerLatestValue<Preferences>>({ scope, rendered: preferences, latest: preferences });
  useLayoutEffect(() => {
    latestDraft.current = reconcileComposerLatestValue(latestDraft.current, scope, draft);
    latestAttachments.current = reconcileComposerLatestValue(latestAttachments.current, scope, attachments);
    latestPreferences.current = reconcileComposerLatestValue(latestPreferences.current, scope, preferences);
  }, [attachments, draft, preferences, scope]);
  return { draft: latestDraft, attachments: latestAttachments, preferences: latestPreferences };
}
