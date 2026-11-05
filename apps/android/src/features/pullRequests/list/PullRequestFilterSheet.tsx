import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AccountState, ForgeProvider } from "../../../data/forgeContract";
import type { PullRequestSearchFilter, SearchValues } from "../../../data/forgePullRequestSearch";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { AppText as Text } from "../../../ui/Typography";
import { Tray, useTray, type ITrayPalette } from "../../../vendor/reacticx/tray";
import {
  activePullRequestFilterCount,
  applyPullRequestFilters,
  dismissPullRequestFilters,
  pullRequestFilterSheetModel,
  resetPullRequestFilterDraft,
  selectPullRequestFilterFacet,
  updatePullRequestFilterDraft,
  type PullRequestFilterFacet,
} from "../pullRequestListModel";
import { catalogAccountLogins, isCatalogAccount } from "./catalogAccounts";
import { filterStyles as styles } from "./filter.styles";
import { filterTrayViewportGeometry } from "./filterTrayViewport";
import { PullRequestTermField, type PullRequestTermSuggestion } from "./PullRequestTermField";

const FILTERS_VIEW = "pull-request-filters";
const FILTER_DETAIL_VIEW = "pull-request-filter-detail";
const FILTER_TRAY_PALETTE: Partial<ITrayPalette> = {
  backdrop: colors.scrim,
  border: colors.surfaceContainer,
  handle: colors.textDim,
  mutedText: colors.textMuted,
  surface: colors.surfaceContainer,
  text: colors.text,
};
/** Metadata fields have no account-derived values to offer. */
const NO_SUGGESTIONS: readonly PullRequestTermSuggestion[] = [];
const REVIEW_OPTIONS = [
  ["none", "No review"],
  ["required", "Review required"],
  ["approved", "Approved"],
  ["changesRequested", "Changes requested"],
] as const;
const STATE_OPTIONS = [
  ["open", "Open"],
  ["draft", "Draft"],
  ["merged", "Merged"],
  ["closed", "Closed"],
] as const;
const DELIVERY_OPTIONS = [
  ["failing", "Checks failing"],
  ["pending", "Checks pending"],
  ["passing", "Checks passing"],
  ["none", "No checks"],
] as const;
const FACETS: readonly {
  readonly detail: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly value: PullRequestFilterFacet;
}[] = [
  {
    detail: "Provider, account, repository",
    icon: "git-network-outline",
    label: "Sources",
    value: "sources",
  },
  {
    detail: "Author, assignee, reviewer",
    icon: "people-outline",
    label: "People",
    value: "people",
  },
  {
    detail: "Required, approved, changes requested",
    icon: "checkmark-circle-outline",
    label: "Review",
    value: "review",
  },
  {
    detail: "Open, draft, merged, closed",
    icon: "git-pull-request-outline",
    label: "State",
    value: "state",
  },
  {
    detail: "Checks and merge signal",
    icon: "pulse-outline",
    label: "Delivery",
    value: "delivery",
  },
  {
    detail: "Labels and branches",
    icon: "pricetags-outline",
    label: "Metadata",
    value: "metadata",
  },
];

/** Atomic filter editor. Outside-dismiss discards its draft. */
export function PullRequestFilterSheet({
  accounts,
  providers,
  repositories,
}: {
  readonly accounts: readonly AccountState[];
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
}): React.JSX.Element {
  const state = useSelector(() => pullRequestFilterSheetModel.get());
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((keyboard) => keyboard.height);
  const viewport = filterTrayViewportGeometry({
    bottomInset: insets.bottom,
    keyboardHeight,
    topInset: insets.top,
    windowHeight: height,
  });
  const open = state.status === "open";
  const visibleState = state.status === "open" ? state : state.retained;
  const handleOpenChange = useEvent((next: boolean) => {
    if (!next) {
      dismissPullRequestFilters();
    }
  });
  const handleViewChange = useEvent((view: string) => {
    if (view === FILTERS_VIEW) {
      selectPullRequestFilterFacet(null);
    }
  });
  return (
    <Tray
      defaultView={FILTERS_VIEW}
      key={state.session}
      onOpenChange={handleOpenChange}
      onViewChange={handleViewChange}
      open={open}
      palette={FILTER_TRAY_PALETTE}
      theme="dark"
    >
      <FilterTraySurface
        accounts={accounts}
        bottomInsetCompensation={viewport.bottomInsetCompensation}
        providers={providers}
        repositories={repositories}
        trayHeight={viewport.height}
        visibleState={visibleState}
      />
    </Tray>
  );
}

function FilterTraySurface({
  accounts,
  bottomInsetCompensation,
  providers,
  repositories,
  trayHeight,
  visibleState,
}: {
  readonly accounts: readonly AccountState[];
  readonly bottomInsetCompensation: number;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
  readonly trayHeight: number;
  readonly visibleState: {
    readonly draft: PullRequestSearchFilter;
    readonly facet: PullRequestFilterFacet | null;
  } | null;
}): React.JSX.Element {
  return (
    <Tray.Content style={[styles.sheet, { marginBottom: -bottomInsetCompensation }]}>
      <Tray.View id={FILTERS_VIEW} style={[styles.fill, { height: trayHeight }]}>
        {visibleState === null ? null : <FilterFacetIndex draft={visibleState.draft} />}
      </Tray.View>
      <Tray.View id={FILTER_DETAIL_VIEW} style={[styles.fill, { height: trayHeight }]}>
        {visibleState === null || visibleState.facet === null ? null : (
          <FilterFacetDetail
            accounts={accounts}
            draft={visibleState.draft}
            facet={visibleState.facet}
            providers={providers}
            repositories={repositories}
          />
        )}
      </Tray.View>
    </Tray.Content>
  );
}

function FilterFacetIndex({
  draft,
}: {
  readonly draft: PullRequestSearchFilter;
}): React.JSX.Element {
  return (
    <View style={styles.fill} testID="pull-request-filter-sheet">
      <FilterHeader count={activePullRequestFilterCount(draft)} title="Filters" />
      <View style={styles.body}>
        <FacetList draft={draft} />
      </View>
      <FilterFooter />
    </View>
  );
}

function FilterFacetDetail({
  accounts,
  draft,
  facet,
  providers,
  repositories,
}: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
  readonly facet: PullRequestFilterFacet;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
}): React.JSX.Element {
  const selected = FACETS.find((item) => item.value === facet);
  return (
    <View style={styles.fill} testID={`pull-request-filter-${facet}-view`}>
      <FilterHeader
        back
        count={activePullRequestFilterCount(draft)}
        title={selected?.label ?? "Filters"}
      />
      <View style={styles.body}>
        <FacetPane
          accounts={accounts}
          draft={draft}
          facet={facet}
          providers={providers}
          repositories={repositories}
        />
      </View>
      <FilterFooter />
    </View>
  );
}

function FacetPane({
  accounts,
  draft,
  facet,
  providers,
  repositories,
}: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
  readonly facet: PullRequestFilterFacet | null;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
}): React.JSX.Element | null {
  if (facet === null) {
    return null;
  }
  return (
    <ScrollView
      contentContainerStyle={styles.facetContent}
      // Token removal and suggestions take the first tap while a token field is focused.
      keyboardShouldPersistTaps="handled"
      style={styles.facetScroll}
    >
      <FacetContent
        accounts={accounts}
        draft={draft}
        facet={facet}
        providers={providers}
        repositories={repositories}
      />
    </ScrollView>
  );
}

function FilterHeader({
  back = false,
  count,
  title,
}: {
  readonly back?: boolean;
  readonly count: number;
  readonly title: string;
}): React.JSX.Element {
  return (
    <Tray.Header style={styles.header}>
      <FilterHeaderIdentity back={back} title={title} />
      <FilterHeaderActions count={count} />
    </Tray.Header>
  );
}

function FilterHeaderIdentity({
  back,
  title,
}: {
  readonly back: boolean;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.headerIdentity}>
      {back ? <FilterHeaderBack /> : null}
      <Tray.Title style={styles.headerTitle}>{title}</Tray.Title>
    </View>
  );
}

function FilterHeaderBack(): React.JSX.Element {
  return (
    <Tray.Back style={styles.headerButton}>
      <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
    </Tray.Back>
  );
}

function FilterHeaderActions({ count }: { readonly count: number }): React.JSX.Element {
  const reset = useEvent(() => {
    resetPullRequestFilterDraft();
  });
  return (
    <View style={styles.headerActions}>
      {count === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={reset}
          style={styles.resetButton}
          testID="pull-request-reset-filters"
        >
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      )}
      <Tray.Close>
        {({ color, size }) => <Ionicons color={color} name="close" size={size} />}
      </Tray.Close>
    </View>
  );
}

function FilterFooter(): React.JSX.Element {
  const apply = useEvent(() => {
    applyPullRequestFilters();
  });
  return (
    <Tray.Footer style={styles.footer}>
      <Pressable accessibilityRole="button" onPress={apply} style={styles.applyButton}>
        <Text style={styles.applyText}>Apply filters</Text>
      </Pressable>
    </Tray.Footer>
  );
}

function FacetList({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.facetList} style={styles.facetNav}>
      {FACETS.map((facet) => (
        <FacetRow draft={draft} facet={facet} key={facet.value} />
      ))}
    </ScrollView>
  );
}

function FacetRow({
  draft,
  facet,
}: {
  readonly draft: PullRequestSearchFilter;
  readonly facet: (typeof FACETS)[number];
}): React.JSX.Element {
  const tray = useTray();
  const select = useEvent(() => {
    selectPullRequestFilterFacet(facet.value);
    tray.setView(FILTER_DETAIL_VIEW);
  });
  return (
    <Pressable accessibilityRole="button" onPress={select} style={styles.facetRow}>
      <FacetIcon facet={facet} />
      <View style={styles.facetBody}>
        <Text style={styles.optionTitle}>{facet.label}</Text>
        <Text style={styles.optionDetail}>{facet.detail}</Text>
      </View>
      <FacetBadge draft={draft} facet={facet.value} />
      <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

function FacetIcon({ facet }: { readonly facet: (typeof FACETS)[number] }): React.JSX.Element {
  return (
    <View style={styles.facetIcon}>
      <Ionicons color={colors.textMuted} name={facet.icon} size={iconSize.inline} />
    </View>
  );
}

function FacetBadge({
  draft,
  facet,
}: {
  readonly draft: PullRequestSearchFilter;
  readonly facet: PullRequestFilterFacet;
}): React.JSX.Element | null {
  const count = facetCount(draft, facet);
  return count === 0 ? null : (
    <View style={styles.facetBadge}>
      <Text style={styles.facetBadgeText}>{String(count)}</Text>
    </View>
  );
}

function FacetContent(props: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
  readonly facet: PullRequestFilterFacet;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
}): React.JSX.Element | null {
  switch (props.facet) {
    case "sources":
      return <SourcesFacet {...props} />;
    case "people":
      return <PeopleFacet accounts={props.accounts} draft={props.draft} />;
    case "review":
      return <ReviewFacet draft={props.draft} />;
    case "state":
      return <StateFacet draft={props.draft} />;
    case "delivery":
      return <DeliveryFacet draft={props.draft} />;
    case "metadata":
      return <MetadataFacet draft={props.draft} />;
    default:
      return null;
  }
}

function SourcesFacet({
  accounts,
  draft,
  providers,
  repositories,
}: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
}): React.JSX.Element {
  const enabled = providers.filter((provider) => provider.enabled);
  const connected = accounts.filter(isCatalogAccount);
  const selectedProviders = new Set(draft.providerIds);
  const selectedAccounts = new Set(draft.accounts);
  return (
    <View>
      <FacetIntro text="Choose sources. An empty selection means every connected source." />
      <SectionLabel label="Providers" />
      {enabled.map((provider) => (
        <SourceOption
          checked={draft.providerIds.length === 0 || selectedProviders.has(provider.pluginId)}
          icon={provider}
          key={provider.pluginId}
          label={provider.forgeName}
          onPress={() => {
            updatePullRequestFilterDraft((current) => ({
              ...current,
              providerIds: toggleScope(
                current.providerIds,
                provider.pluginId,
                enabled.map((item) => item.pluginId),
              ),
            }));
          }}
        />
      ))}
      <SectionLabel label="Accounts" />
      {connected.map((account) => (
        <SourceOption
          checked={draft.accounts.length === 0 || selectedAccounts.has(account.account)}
          detail={`${account.login} · ${account.host}`}
          key={account.account}
          label={account.login}
          onPress={() => {
            updatePullRequestFilterDraft((current) => ({
              ...current,
              accounts: toggleScope(
                current.accounts,
                account.account,
                connected.map((item) => item.account),
              ),
            }));
          }}
        />
      ))}
      <SectionLabel label="Repositories" />
      {repositories.length === 0 ? (
        <Text style={styles.emptyHint}>Repositories appear after the first result.</Text>
      ) : null}
      {repositories.map((repository) => (
        <TriStateOption
          key={repository}
          label={repository}
          onChange={(next) => {
            updatePullRequestFilterDraft((current) => ({
              ...current,
              query: {
                ...current.query,
                repositories: nextValues(current.query.repositories, repository, next),
              },
            }));
          }}
          state={valueState(draft.query.repositories, repository)}
        />
      ))}
    </View>
  );
}

function PeopleFacet({
  accounts,
  draft,
}: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
}): React.JSX.Element {
  const suggestions = catalogAccountLogins(accounts).map((login) => ({
    label: `${login} (you)`,
    value: login,
  }));
  return (
    <View>
      <FacetIntro text="Add logins with Enter or a comma. A pull request matches any login in a field and every field you fill." />
      <PullRequestTermField
        field="authors"
        hint="Opened by any of these people."
        label="Author"
        placeholder="Add a login"
        suggestions={suggestions}
        values={draft.query.authors}
      />
      <PullRequestTermField
        field="assignees"
        hint="Assigned to any of these people."
        label="Assignee"
        placeholder="Add a login"
        suggestions={suggestions}
        values={draft.query.assignees}
      />
      <PullRequestTermField
        field="reviewers"
        hint="Reviewed by any of these people."
        label="Reviewed by"
        placeholder="Add a login"
        suggestions={suggestions}
        values={draft.query.reviewers}
      />
    </View>
  );
}

function ReviewFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <EnumFacet
      onChange={(value, state) => {
        updatePullRequestFilterDraft((current) => ({
          ...current,
          query: { ...current.query, review: nextValues(current.query.review, value, state) },
        }));
      }}
      options={REVIEW_OPTIONS}
      values={draft.query.review}
    />
  );
}

function StateFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <EnumFacet
      onChange={(value, state) => {
        updatePullRequestFilterDraft((current) => ({
          ...current,
          query: { ...current.query, states: nextStateValues(current.query.states, value, state) },
        }));
      }}
      options={STATE_OPTIONS}
      values={draft.query.states}
    />
  );
}

function DeliveryFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <EnumFacet
      onChange={(value, state) => {
        updatePullRequestFilterDraft((current) => ({
          ...current,
          query: { ...current.query, checks: nextValues(current.query.checks, value, state) },
        }));
      }}
      options={DELIVERY_OPTIONS}
      values={draft.query.checks}
    />
  );
}

function MetadataFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <View>
      <FacetIntro text="Add exact names with Enter or a comma. A pull request matches any value in a field and every field you fill." />
      <PullRequestTermField
        field="labels"
        hint="Carries any of these labels."
        label="Labels"
        placeholder="Add a label"
        suggestions={NO_SUGGESTIONS}
        values={draft.query.labels}
      />
      <PullRequestTermField
        field="baseBranches"
        hint="Merges into any of these branches."
        label="Base branch"
        placeholder="Add a branch"
        suggestions={NO_SUGGESTIONS}
        values={draft.query.baseBranches}
      />
      <PullRequestTermField
        field="headBranches"
        hint="Comes from any of these branches."
        label="Head branch"
        placeholder="Add a branch"
        suggestions={NO_SUGGESTIONS}
        values={draft.query.headBranches}
      />
    </View>
  );
}

function EnumFacet<Value extends string>({
  onChange,
  options,
  values,
}: {
  readonly onChange: (value: Value, state: "exclude" | "include" | "off") => void;
  readonly options: readonly (readonly [Value, string])[];
  readonly values: SearchValues<Value>;
}): React.JSX.Element {
  return (
    <View>
      <FacetIntro text="Tap once to include, twice to exclude, three times to clear." />
      {options.map(([value, label]) => (
        <TriStateOption
          key={value}
          label={label}
          onChange={(next) => {
            onChange(value, next);
          }}
          state={valueState(values, value)}
        />
      ))}
    </View>
  );
}

function SourceOption({
  checked,
  detail,
  icon,
  label,
  onPress,
}: {
  readonly checked: boolean;
  readonly detail?: string;
  readonly icon?: ForgeProvider;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  const press = useEvent(() => {
    onPress();
  });
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={press}
      style={styles.optionRow}
    >
      <CheckBox checked={checked} />
      {icon === undefined ? null : <ForgeIcon icon={icon.icon} size={iconSize.action} />}
      <View style={styles.facetBody}>
        <Text numberOfLines={1} style={styles.optionTitle}>
          {label}
        </Text>
        {detail === undefined ? null : (
          <Text numberOfLines={1} style={styles.optionDetail}>
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function TriStateOption({
  label,
  onChange,
  state,
}: {
  readonly label: string;
  readonly onChange: (state: "exclude" | "include" | "off") => void;
  readonly state: "exclude" | "include" | "off";
}): React.JSX.Element {
  const next = state === "off" ? "include" : state === "include" ? "exclude" : "off";
  const press = useEvent(() => {
    onChange(next);
  });
  return (
    <Pressable
      accessibilityLabel={`${label}: ${state}`}
      accessibilityRole="button"
      onPress={press}
      style={styles.optionRow}
    >
      <View style={[styles.triState, state !== "off" && styles.triStateActive]}>
        {state === "include" ? (
          <Ionicons color={colors.onPrimary} name="checkmark" size={iconSize.indicator} />
        ) : null}
        {state === "exclude" ? (
          <Ionicons color={colors.onPrimary} name="remove" size={iconSize.indicator} />
        ) : null}
      </View>
      <Text style={styles.optionTitle}>{label}</Text>
      {state === "off" ? null : <Text style={styles.optionDetail}>{state}</Text>}
    </Pressable>
  );
}

function CheckBox({ checked }: { readonly checked: boolean }): React.JSX.Element {
  return (
    <View style={[styles.checkBox, checked && styles.checkBoxSelected]}>
      {checked ? (
        <Ionicons color={colors.onPrimary} name="checkmark" size={iconSize.indicator} />
      ) : null}
    </View>
  );
}

function FacetIntro({ text }: { readonly text: string }): React.JSX.Element {
  return <Text style={styles.intro}>{text}</Text>;
}

function SectionLabel({ label }: { readonly label: string }): React.JSX.Element {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function toggleScope<Value extends string>(
  current: readonly Value[],
  value: Value,
  all: readonly Value[],
): readonly Value[] {
  const selected = current.length === 0 ? all : current;
  if (selected.includes(value)) {
    const next = selected.filter((candidate) => candidate !== value);
    return next.length === 0 || next.length === all.length ? [] : next;
  }
  const next = [...selected, value];
  return next.length === all.length ? [] : next;
}

function valueState<Value>(
  values: SearchValues<Value>,
  value: Value,
): "exclude" | "include" | "off" {
  return values.include.includes(value)
    ? "include"
    : values.exclude.includes(value)
      ? "exclude"
      : "off";
}

function nextValues<Value extends string>(
  values: SearchValues<Value>,
  value: Value,
  state: "exclude" | "include" | "off",
): SearchValues<Value> {
  const exclude = values.exclude.filter((candidate) => candidate !== value);
  const include = values.include.filter((candidate) => candidate !== value);
  if (state === "exclude") {
    return { exclude: [...exclude, value], include };
  }
  if (state === "include") {
    return { exclude, include: [...include, value] };
  }
  return { exclude, include };
}

function nextStateValues(
  values: PullRequestSearchFilter["query"]["states"],
  value: PullRequestSearchFilter["query"]["states"]["include"][number],
  state: "exclude" | "include" | "off",
): PullRequestSearchFilter["query"]["states"] {
  const onlyDefaultOpen =
    values.exclude.length === 0 && values.include.length === 1 && values.include[0] === "open";
  if (onlyDefaultOpen && value !== "open" && state === "include") {
    return { exclude: [], include: [value] };
  }
  return nextValues(values, value, state);
}

function valueCount(field: SearchValues<unknown>): number {
  return field.include.length + field.exclude.length;
}

function facetCount(filter: PullRequestSearchFilter, facet: PullRequestFilterFacet): number {
  switch (facet) {
    case "sources":
      return (
        filter.providerIds.length + filter.accounts.length + valueCount(filter.query.repositories)
      );
    case "people":
      return (
        valueCount(filter.query.authors) +
        valueCount(filter.query.assignees) +
        valueCount(filter.query.reviewers)
      );
    case "review":
      return valueCount(filter.query.review);
    case "state":
      return isDefaultState(filter.query.states) ? 0 : valueCount(filter.query.states);
    case "delivery":
      return valueCount(filter.query.checks);
    case "metadata":
      return (
        valueCount(filter.query.labels) +
        valueCount(filter.query.baseBranches) +
        valueCount(filter.query.headBranches)
      );
    default:
      return 0;
  }
}

function isDefaultState(values: PullRequestSearchFilter["query"]["states"]): boolean {
  return values.exclude.length === 0 && values.include.length === 1 && values.include[0] === "open";
}
