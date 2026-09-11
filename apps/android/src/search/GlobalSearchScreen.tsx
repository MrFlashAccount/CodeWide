import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { useSelector } from "@legendapp/state/react";
import { lazy, Suspense, useState } from "react";
import { Keyboard, Pressable, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { searchDateBoundary, type MessageSearchHit, type MessageSearchPage } from "../data/message-search";
import type { RemoteWorkspace } from "../data/use-remote-workspace";
import { useEvent } from "../react/useEvent";
import { useAsyncResource } from "../rendering/async-resource-store";
import { searchFieldLayout } from "../presentation/input/searchLayout";
import { InlineIcon } from "../ui/InlineIcon";
import { threadListLayout } from "../ui/thread-list-layout";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../theme";
import { AppText as Text, AppTextInput as TextInput } from "../ui/Typography";
import { WaveText } from "../ui/WaveText";
import { AppPopover } from "../ui/AppPopover";
import type { SearchSession } from "./search-session";
import { SearchFilters, type SearchDateField, type SearchFilterValue, type SearchProject, type SearchServer, type SearchThread } from "./SearchFilters";

const SearchCalendar = lazy(() => import("./SearchCalendar"));

export interface LocatedSearchHit { readonly connectionId: string; readonly hit: MessageSearchHit }
interface SearchScreenProps {
  readonly remote: Pick<RemoteWorkspace, "searchMessages">;
  readonly servers: readonly SearchServer[];
  readonly threads: readonly SearchThread[];
  readonly projects: readonly SearchProject[];
  readonly session: SearchSession;
  readonly onClose: () => void;
  readonly onOpenThread: (target: LocatedSearchHit, query: string) => void;
}

type ServerSearchResult = { readonly status: "ready"; readonly connectionId: string; readonly page: MessageSearchPage }
  | { readonly status: "error"; readonly connectionId: string; readonly message: string };

/** Global indexed search is isolated from the live conversation's resident window. */
export function GlobalSearchScreen(props: SearchScreenProps) {
  const session = props.session;
  const text = useSelector(() => session.text$.get());
  const filterValue = useSelector(() => session.filters$.get());
  const request = useSelector(() => session.request$.get());
  const filterError = useSelector(() => session.error$.get());
  const [filters, setFilters] = useState(false);
  const [calendar, setCalendar] = useState<SearchDateField | null>(null);
  const pickDate = (field: SearchDateField) => { setFilters(false); setCalendar(field); };
  const dismissCalendar = useEvent(() => { setCalendar(null); setFilters(true); });
  const selectCalendarDay = useEvent((day: string) => {
    if (calendar === null) return;
    session.filters$[calendar].set(day);
    dismissCalendar();
  });
  const [autoFocus] = useState(() => session.shouldFocus());
  const window = useWindowDimensions();
  const search = useEvent(() => {
    if (!session.submit()) { if (session.error$.peek() !== null) setFilters(true); return; }
    setFilters(false);
    Keyboard.dismiss();
  });
  const setText = useEvent((value: string) => session.changeText(value));
  const didFocus = () => session.didFocus();
  const setFilterValue = useEvent((value: SearchFilterValue) => session.filters$.set(value));
  const close = useEvent(() => { session.cancelPending(); Keyboard.dismiss(); props.onClose(); });
  const resetFilters = () => { session.filters$.set({ serverId: "", project: "", threadId: "", from: "", until: "" }); session.error$.set(null); };
  const resource = useAsyncResource<readonly ServerSearchResult[]>(request === null ? null : `sidebar-search:${session.id}`, JSON.stringify(request), async () => {
    if (request === null) return [];
    const query = { query: request.text, project: request.project.trim() || null, threadId: request.threadId || null,
      from: searchDateBoundary(request.from, false), until: searchDateBoundary(request.until, true), offset: request.page * 30 };
    if (query.from !== null && query.until !== null && query.from >= query.until) throw new Error("The start date must precede the end date");
    return await Promise.all(props.servers.filter((server) => request.serverId === "" || server.id === request.serverId).map(async (server): Promise<ServerSearchResult> => {
      try { return { status: "ready", connectionId: server.id, page: await props.remote.searchMessages(server.id, query) }; }
      catch (cause) { return { status: "error", connectionId: server.id, message: cause instanceof Error ? cause.message : "Search failed" }; }
    }));
  });
  const results: LocatedSearchHit[] = [];
  for (const server of resource.value ?? []) {
    if (server.status === "ready") for (const hit of server.page.data) results.push({ connectionId: server.connectionId, hit });
  }
  results.sort((left, right) => right.hit.timestamp.localeCompare(left.hit.timestamp));
  const nextPage = useEvent(() => session.changePage(1));
  const previousPage = useEvent(() => session.changePage(-1));
  const toggleFilters = () => setFilters(!filters);
  const selectResult = useEvent((target: LocatedSearchHit) => { Keyboard.dismiss(); props.onOpenThread(target, request?.text ?? ""); });
  const saveOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => session.rememberScroll(event.nativeEvent.contentOffset.y);
  const filterCount = Object.values(filterValue).filter(value => value.trim() !== "").length;
  const failed = resource.error !== null || resource.value?.some(server => server.status === "error") === true;
  return <View testID="sidebar-search" style={styles.root}>
    <View testID="search-top-input" style={styles.header}>
      <View testID="expanded-thread-search-field" style={styles.searchBar}>
        <InlineIcon name="search" color={colors.textMuted} role="body" />
        <TextInput compact accessibilityLabel="Search all messages" value={text} onChangeText={setText} onSubmitEditing={search} returnKeyType="search" placeholder="Search messages" autoFocus={autoFocus} onFocus={didFocus} style={styles.input} />
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close search" style={styles.icon}><Ionicons name="close" size={iconSize.action} color={colors.textMuted} /></Pressable>
      </View>
      <AppPopover open={filters} onOpenChange={setFilters} width={Math.min(320, window.width - spacing.lg * 2)} placement="bottom" align="end" trigger={
        <Pressable onPress={toggleFilters} accessibilityRole="button" accessibilityLabel="Search filters" accessibilityState={{ expanded: filters }} style={styles.filterButton}>
          <Ionicons name="options-outline" size={iconSize.action} color={filterCount > 0 ? colors.text : colors.textMuted} />
          {filterCount > 0 && <View style={styles.filterDot} />}
        </Pressable>}>
        <View style={{ maxHeight: Math.max(controlSize.regular * 3, window.height * 0.65) }}>
          <View style={styles.filterHeader}><Text style={styles.title}>Filters</Text><Pressable onPress={resetFilters} accessibilityLabel="Reset search filters" style={styles.reset}><Text style={styles.label}>Reset</Text></Pressable></View>
          {filterError !== null && <Text accessibilityRole="alert" style={styles.error}>{filterError}</Text>}
          <SearchFilters value={filterValue} onChange={setFilterValue} servers={props.servers} threads={props.threads} projects={props.projects} onPickDate={pickDate} />
          <Pressable onPress={search} accessibilityRole="button" accessibilityLabel="Apply search filters" style={styles.apply}><Text style={styles.title}>Apply</Text></Pressable>
        </View>
      </AppPopover>
    </View>
    {calendar !== null && <Suspense fallback={null}><SearchCalendar value={filterValue[calendar]} onSelect={selectCalendarDay} onDismiss={dismissCalendar} /></Suspense>}
    {resource.status === "loading" && <WaveText text="Searching messages" style={styles.notice} />}
    {resource.error !== null && <Text accessibilityRole="alert" style={styles.error}>{resource.error}</Text>}
    {(resource.value ?? []).map(server => <SearchServerNotice key={server.connectionId} result={server} name={props.servers.find(candidate => candidate.id === server.connectionId)?.name || "Server"} />)}
    <LegendList key={`${request?.revision ?? 0}:${request?.page ?? 0}`} data={results} renderItem={entry => <SearchResultRow target={entry.item} query={request?.text ?? ""} onSelect={selectResult} />} keyExtractor={resultKey} recycleItems style={styles.list} keyboardShouldPersistTaps="handled" initialScrollOffset={session.scrollOffset} onScroll={saveOffset} scrollEventThrottle={100}
      ListHeaderComponent={results.length > 0 ? <Text style={styles.notice}>Threads & messages</Text> : null}
      ListEmptyComponent={resource.status !== "loading" && !failed ? <View style={styles.empty}>
        <Text style={styles.title}>{request === null ? "Find a message" : "No matches"}</Text>
        <Text style={styles.label}>{request === null ? "Search titles and message history across your chats." : "Try different words or fewer filters."}</Text>
      </View> : null} />
    <View style={styles.pagination}>
      {(request?.page ?? 0) > 0 && <Pressable onPress={previousPage} style={styles.reset}><Text style={styles.label}>Previous</Text></Pressable>}
      {resource.value?.some(server => server.status === "ready" && server.page.nextOffset !== null) === true && <Pressable onPress={nextPage} style={styles.reset}><Text style={styles.label}>Next</Text></Pressable>}
    </View>
  </View>;
}

interface ServerNoticeProps { readonly result: ServerSearchResult; readonly name: string }
function SearchServerNotice(props: ServerNoticeProps) {
  const result = props.result;
  if (result.status === "error") return <Text style={styles.error}>{props.name}: {result.message}</Text>;
  if (result.page.failedSources > 0) return <View style={styles.partialNotice}>
    <Ionicons name="information-circle-outline" size={iconSize.inline} color={colors.textMuted} accessible={false} />
    <Text numberOfLines={1} style={styles.partialNoticeText} accessibilityLabel={`${props.name}: Results are incomplete. ${result.page.failedSources} chat histories could not be indexed.`}>
      {props.name} · {result.page.failedSources} {result.page.failedSources === 1 ? "chat" : "chats"} not indexed
    </Text>
  </View>;
  return result.page.indexing ? <WaveText text={`${props.name}: indexing history · results are incomplete`} style={styles.notice} /> : null;
}

interface ResultProps { readonly target: LocatedSearchHit; readonly query: string; readonly onSelect: (hit: LocatedSearchHit) => void }
function SearchResultRow(props: ResultProps) {
  const select = useEvent(() => props.onSelect(props.target));
  return <Pressable onPress={select} style={styles.result} accessibilityRole="button">
    <View style={styles.resultHeading}><Text style={styles.resultTitle} numberOfLines={1}>{props.target.hit.title || props.target.hit.threadId}</Text><Text style={styles.caption}>{formatSearchTimestamp(props.target.hit.timestamp)}</Text></View>
    <SearchHighlightedText text={props.target.hit.excerpt} query={props.query} />
  </Pressable>;
}

export function formatSearchTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

interface HighlightProps { readonly text: string; readonly query: string }
export function SearchHighlightedText(props: HighlightProps) {
  const tokens = props.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return <Text style={styles.label} numberOfLines={3}>{props.text.split(/(\s+)/u).map((part, index) => <Text key={index} style={tokens.length > 0 && tokens.some((token) => part.toLocaleLowerCase().includes(token)) ? styles.highlight : undefined}>{part}</Text>)}</Text>;
}

function resultKey(result: LocatedSearchHit): string { return `${result.connectionId}:${result.hit.messageId}`; }

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, list: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.optical, paddingLeft: spacing.md, paddingRight: threadListLayout.edgeInset, paddingBottom: spacing.xs },
  searchBar: { ...searchFieldLayout, height: controlSize.regular, flex: 1, minWidth: 0 },
  input: { flex: 1, minWidth: 0, height: controlSize.regular, padding: 0, ...typeScale.body, color: colors.text },
  filterButton: { width: controlSize.touch, minHeight: controlSize.touch, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow },
  icon: { width: controlSize.regular, height: controlSize.regular, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  filterDot: { position: "absolute", right: spacing.xs, top: spacing.xs, width: spacing.xs, height: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.primary },
  filterHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md },
  reset: { minHeight: controlSize.regular, justifyContent: "center", paddingHorizontal: spacing.sm },
  apply: { minHeight: controlSize.regular, alignItems: "center", justifyContent: "center", margin: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radii.medium },
  empty: { padding: spacing.md, gap: spacing.sm },
  pagination: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.sm },
  label: { ...typeScale.body, color: colors.textMuted }, title: { ...typeScale.body, color: colors.text },
  resultTitle: { flex: 1, minWidth: 0, ...typeScale.body, color: colors.text },
  resultHeading: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  caption: { ...typeScale.caption, color: colors.textDim, flexShrink: 0 }, notice: { ...typeScale.caption, color: colors.textMuted, margin: spacing.md },
  error: { ...typeScale.caption, color: colors.error, margin: spacing.md },
  partialNotice: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  partialNoticeText: { flex: 1, minWidth: 0, ...typeScale.caption, color: colors.textMuted },
  result: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  highlight: { color: colors.text, backgroundColor: colors.warningContainer },
});
