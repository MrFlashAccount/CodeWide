import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";

import type { AccountState, ForgeProvider } from "../../../data/forgeContract";
import type { PullRequestSearchFilter, SearchValues } from "../../../data/forgePullRequestSearch";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { AppText as Text } from "../../../ui/Typography";
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
import { filterStyles as styles } from "./filter.styles";

const WIDE_FILTER_WIDTH = 600;
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
const SORT_OPTIONS = [
  { direction: "descending", field: "updated", label: "Recently updated" },
  { direction: "ascending", field: "updated", label: "Least recently updated" },
  { direction: "descending", field: "created", label: "Newest created" },
  { direction: "ascending", field: "created", label: "Oldest created" },
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
  { detail: "Updated or created", icon: "swap-vertical-outline", label: "Sort", value: "sort" },
  {
    detail: "Text and common qualifiers",
    icon: "terminal-outline",
    label: "Advanced query",
    value: "advanced",
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
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_FILTER_WIDTH;
  const open = state.status === "open";
  const handleOpenChange = useEvent((next: boolean) => {
    if (!next) {
      dismissPullRequestFilters();
    }
  });
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close filters",
        enableDynamicSizing: false,
        performanceSurface: "pull-request-filters",
        snapPoints: ["88%"],
        style: styles.sheet,
      }}
      isOpen={open}
      onOpenChange={handleOpenChange}
    >
      {open ? (
        <OpenFilterSheet
          accounts={accounts}
          draft={state.draft}
          facet={state.facet}
          providers={providers}
          repositories={repositories}
          wide={wide}
        />
      ) : null}
    </AppSheet>
  );
}

function OpenFilterSheet({
  accounts,
  draft,
  facet,
  providers,
  repositories,
  wide,
}: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
  readonly facet: PullRequestFilterFacet | null;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
  readonly wide: boolean;
}): React.JSX.Element {
  const visibleFacet = wide ? (facet ?? "sources") : facet;
  return (
    <View style={styles.fill} testID="pull-request-filter-sheet">
      <FilterHeader facet={wide ? null : facet} />
      <FilterSheetBody
        accounts={accounts}
        draft={draft}
        providers={providers}
        repositories={repositories}
        visibleFacet={visibleFacet}
        wide={wide}
      />
      <FilterFooter count={activePullRequestFilterCount(draft)} />
    </View>
  );
}

function FilterSheetBody({
  accounts,
  draft,
  providers,
  repositories,
  visibleFacet,
  wide,
}: {
  readonly accounts: readonly AccountState[];
  readonly draft: PullRequestSearchFilter;
  readonly providers: readonly ForgeProvider[];
  readonly repositories: readonly string[];
  readonly visibleFacet: PullRequestFilterFacet | null;
  readonly wide: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.body, wide && styles.bodyWide]}>
      {wide || visibleFacet === null ? (
        <FacetList draft={draft} selected={visibleFacet} wide={wide} />
      ) : null}
      <FacetPane
        accounts={accounts}
        draft={draft}
        facet={visibleFacet}
        providers={providers}
        repositories={repositories}
      />
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
    <ScrollView contentContainerStyle={styles.facetContent} style={styles.facetScroll}>
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
  facet,
}: {
  readonly facet: PullRequestFilterFacet | null;
}): React.JSX.Element {
  const selected = FACETS.find((item) => item.value === facet);
  const back = useEvent(() => {
    selectPullRequestFilterFacet(null);
  });
  const reset = useEvent(() => {
    resetPullRequestFilterDraft();
  });
  return (
    <View style={styles.header}>
      {facet === null ? null : (
        <Pressable
          accessibilityLabel="Back to filter groups"
          accessibilityRole="button"
          onPress={back}
          style={styles.headerButton}
        >
          <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
        </Pressable>
      )}
      <Text accessibilityRole="header" style={styles.headerTitle}>
        {selected?.label ?? "Filters"}
      </Text>
      <Pressable accessibilityRole="button" onPress={reset} style={styles.resetButton}>
        <Text style={styles.resetText}>Reset</Text>
      </Pressable>
    </View>
  );
}

function FilterFooter({ count }: { readonly count: number }): React.JSX.Element {
  const apply = useEvent(() => {
    applyPullRequestFilters();
  });
  return (
    <View style={styles.footer}>
      <Text style={styles.footerSummary}>
        {count === 0 ? "Default view" : `${String(count)} active`}
      </Text>
      <Pressable accessibilityRole="button" onPress={apply} style={styles.applyButton}>
        <Text style={styles.applyText}>Apply filters</Text>
      </Pressable>
    </View>
  );
}

function FacetList({
  draft,
  selected,
  wide,
}: {
  readonly draft: PullRequestSearchFilter;
  readonly selected: PullRequestFilterFacet | null;
  readonly wide: boolean;
}): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.facetList}
      style={[styles.facetNav, wide && styles.facetNavWide]}
    >
      {FACETS.map((facet) => (
        <FacetRow
          draft={draft}
          facet={facet}
          key={facet.value}
          selected={selected === facet.value}
          wide={wide}
        />
      ))}
    </ScrollView>
  );
}

function FacetRow({
  draft,
  facet,
  selected,
  wide,
}: {
  readonly draft: PullRequestSearchFilter;
  readonly facet: (typeof FACETS)[number];
  readonly selected: boolean;
  readonly wide: boolean;
}): React.JSX.Element {
  const select = useEvent(() => {
    selectPullRequestFilterFacet(facet.value);
  });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={select}
      style={[styles.facetRow, selected && styles.facetRowSelected]}
    >
      <FacetIcon facet={facet} />
      <View style={styles.facetBody}>
        <Text style={styles.optionTitle}>{facet.label}</Text>
        {wide ? null : <Text style={styles.optionDetail}>{facet.detail}</Text>}
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
      return <PeopleFacet draft={props.draft} />;
    case "review":
      return <ReviewFacet draft={props.draft} />;
    case "state":
      return <StateFacet draft={props.draft} />;
    case "delivery":
      return <DeliveryFacet draft={props.draft} />;
    case "metadata":
      return <MetadataFacet draft={props.draft} />;
    case "sort":
      return <SortFacet draft={props.draft} />;
    case "advanced":
      return <AdvancedFacet draft={props.draft} />;
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
  const connected = accounts.filter((account) => account.state === "connected");
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

function PeopleFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <View>
      <FacetIntro text="Comma-separated values within a field are ORed. Different fields are ANDed." />
      <TermsInput
        label="Author"
        onCommit={(values) => {
          updateTextValues("authors", values);
        }}
        values={draft.query.authors}
      />
      <TermsInput
        label="Assignee"
        onCommit={(values) => {
          updateTextValues("assignees", values);
        }}
        values={draft.query.assignees}
      />
      <TermsInput
        label="Reviewed by"
        onCommit={(values) => {
          updateTextValues("reviewers", values);
        }}
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
          query: { ...current.query, states: nextValues(current.query.states, value, state) },
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
      <FacetIntro text="Use comma-separated exact values. Qualifiers remain visible in Advanced query." />
      <TermsInput
        label="Labels"
        onCommit={(values) => {
          updateTextValues("labels", values);
        }}
        values={draft.query.labels}
      />
      <TermsInput
        label="Base branches"
        onCommit={(values) => {
          updateTextValues("baseBranches", values);
        }}
        values={draft.query.baseBranches}
      />
      <TermsInput
        label="Head branches"
        onCommit={(values) => {
          updateTextValues("headBranches", values);
        }}
        values={draft.query.headBranches}
      />
    </View>
  );
}

function SortFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  return (
    <View>
      {SORT_OPTIONS.map((option) => (
        <RadioOption
          checked={
            draft.query.sort.field === option.field &&
            draft.query.sort.direction === option.direction
          }
          key={`${option.field}:${option.direction}`}
          label={option.label}
          onPress={() => {
            updatePullRequestFilterDraft((current) => ({
              ...current,
              query: {
                ...current.query,
                sort: { direction: option.direction, field: option.field },
              },
            }));
          }}
        />
      ))}
    </View>
  );
}

function AdvancedFacet({ draft }: { readonly draft: PullRequestSearchFilter }): React.JSX.Element {
  const commit = useEvent((event: { readonly nativeEvent: { readonly text: string } }) => {
    updatePullRequestFilterDraft((current) => ({
      ...current,
      query: { ...current.query, text: event.nativeEvent.text.trim() },
    }));
  });
  return (
    <View>
      <FacetIntro text="Text and common qualifiers are passed with the structured filters. Provider-only qualifiers require a single compatible source." />
      <TextInput
        accessibilityLabel="Advanced pull request query"
        autoCapitalize="none"
        autoCorrect={false}
        defaultValue={draft.query.text}
        multiline
        onEndEditing={commit}
        placeholder="Search or type a qualifier"
        placeholderTextColor={colors.textDim}
        style={[styles.input, styles.advancedInput]}
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

function TermsInput({
  label,
  onCommit,
  values,
}: {
  readonly label: string;
  readonly onCommit: (values: readonly string[]) => void;
  readonly values: SearchValues<string>;
}): React.JSX.Element {
  const commit = useEvent((event: { readonly nativeEvent: { readonly text: string } }) => {
    onCommit(parseTerms(event.nativeEvent.text));
  });
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        defaultValue={values.include.join(", ")}
        key={values.include.join("\u0000")}
        onEndEditing={commit}
        placeholder="Any"
        placeholderTextColor={colors.textDim}
        style={styles.input}
      />
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
      {icon === undefined ? null : (
        <ForgeIcon glyph={icon.icon.glyph} iconKey={icon.icon.iconKey} size={iconSize.action} />
      )}
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

function RadioOption({
  checked,
  label,
  onPress,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  const press = useEvent(() => {
    onPress();
  });
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={press}
      style={styles.optionRow}
    >
      <CheckBox checked={checked} />
      <Text style={styles.optionTitle}>{label}</Text>
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

function updateTextValues(
  field: "assignees" | "authors" | "baseBranches" | "headBranches" | "labels" | "reviewers",
  include: readonly string[],
): void {
  updatePullRequestFilterDraft((current) => ({
    ...current,
    query: { ...current.query, [field]: { exclude: current.query[field].exclude, include } },
  }));
}

function parseTerms(text: string): readonly string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
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
    case "sort":
      return filter.query.sort.field === "updated" && filter.query.sort.direction === "descending"
        ? 0
        : 1;
    case "advanced":
      return filter.query.text.length === 0 ? 0 : 1;
    default:
      return 0;
  }
}

function isDefaultState(values: PullRequestSearchFilter["query"]["states"]): boolean {
  return values.exclude.length === 0 && values.include.length === 1 && values.include[0] === "open";
}
