import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useDeferredValue, useRef } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import type { PullRequestKey } from "../../data/forgeContract";
import { classifyForgeError } from "../../data/forgeErrors";
import type {
  PullRequestBadge,
  PullRequestCategory,
  PullRequestRow,
} from "../../data/forgePullRequestContract";
import { useForgeQuery } from "../../data/forgeQueryResource";
import { remoteValue } from "../../data/forgeRemoteValue";
import type { ForgeResources } from "../../data/forgeResources";
import { AppButton } from "../../presentation/controls/AppButton";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import { AppSheet } from "../../ui/AppSheet";
import { SheetSearchField } from "../../ui/SheetSearchField";
import { AppText } from "../../ui/Typography";
import { useAppNotice } from "../../ui/useAppNotice";
import { AttachPullRequestChoices } from "./list/AttachPullRequestChoices";
import { pullRequestCategoryOptions } from "./list/pullRequestCategories";
import { PullRequestCategoryChips } from "./list/PullRequestCategoryChips";
import { defaultPullRequestFilter } from "./pullRequestListModel";

type Props = {
  readonly badges: readonly PullRequestBadge[];
  readonly connectionId: string;
  readonly forge: ForgeResources;
  readonly onAttach: (pullRequest: PullRequestKey) => Promise<void>;
  readonly onClose: () => void;
};

const SHEET_HEIGHT_SHARE = 0.72;
const DEFAULT_FILTER = defaultPullRequestFilter();

/** Selects a PR from the current thread's server without changing the main catalog's filters. */
export function AttachPullRequestSheet({
  badges,
  connectionId,
  forge,
  onAttach,
  onClose,
}: Props): React.JSX.Element {
  const { height } = useWindowDimensions();
  const notice = useAppNotice();
  const ui = useConstant(() =>
    observable<{ category: PullRequestCategory; pending: PullRequestKey | null; text: string }>({
      category: "authored",
      pending: null,
      text: "",
    }),
  );
  const category = useSelector(ui.category);
  const text = useDeferredValue(useSelector(ui.text).trim());
  const pending = useSelector(() => ui.get().pending);
  const dismissed = useRef(false);
  const filter = { ...DEFAULT_FILTER, query: { ...DEFAULT_FILTER.query, category, text } };
  const params = { connectionId, filter };
  const state = useForgeQuery(forge.lists, params);
  const page = remoteValue(state);
  const close = useEvent(() => {
    dismissed.current = true;
    onClose();
  });
  const openChanged = useEvent((open: boolean) => {
    if (!open) {
      close();
    }
  });
  const selectCategory = useEvent((next: PullRequestCategory) => {
    ui.category.set(next);
  });
  const choose = useEvent((row: PullRequestRow): void => {
    if (
      dismissed.current ||
      ui.peek().pending !== null ||
      badges.some((badge) => badge.pullRequest === row.pullRequest)
    ) {
      return;
    }
    ui.pending.set(row.pullRequest);
    onAttach(row.pullRequest)
      .then(() => {
        if (!dismissed.current) {
          close();
        }
        notice.show({ label: `Attached ${row.repository} #${row.number}`, variant: "success" });
      })
      .catch((error: unknown) => {
        notice.show({
          description: classifyForgeError(error).message,
          label: "Could not attach pull request",
          variant: "error",
        });
      })
      .finally(() => {
        ui.pending.set(null);
      });
  });
  const retry = useEvent(() => {
    void forge.lists.refresh(params).catch(() => undefined);
  });
  const more = useEvent(async () => forge.loadMoreList(params));
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close pull request picker",
        style: { height: height * SHEET_HEIGHT_SHARE },
      }}
      isOpen
      onOpenChange={openChanged}
    >
      <View style={styles.header}>
        <AppText accessibilityRole="header" style={styles.title}>
          Attach pull request
        </AppText>
        <SheetSearchField clearLabel="Clear search" label="Search pull requests" query$={ui.text} />
      </View>
      <PullRequestCategoryChips
        onSelect={selectCategory}
        options={pullRequestCategoryOptions(page, category)}
        selected={category}
      />
      {state.status === "failed" && (
        <View style={styles.notice}>
          <AppText accessibilityLiveRegion="polite" style={styles.reason}>
            {state.failure.message}
          </AppText>
          <AppButton onPress={retry} size="sm" variant="outline">
            Retry
          </AppButton>
        </View>
      )}
      <AttachPullRequestChoices
        badges={badges}
        failed={state.status === "failed"}
        filter={filter}
        loadMore={more}
        onSelect={choose}
        page={page}
        pending={pending}
      />
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.md },
  notice: {
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  reason: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
    marginBottom: spacing.sm,
  },
});
