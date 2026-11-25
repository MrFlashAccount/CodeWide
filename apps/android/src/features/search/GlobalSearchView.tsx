import { LegendList } from "@legendapp/list/react-native";
import { lazy, Suspense } from "react";
import { Pressable, View } from "react-native";
import { SearchOverlayHeader } from "../../presentation/input/SearchOverlayHeader";
import { ThreadListHeaderAction } from "../../presentation/navigation/ThreadListHeader";
import { controlSize, spacing } from "../../theme";
import { ContentMenu } from "../../ui/ContentMenu";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { styles } from "./GlobalSearchScreen.styles";
import type { renderGlobalSearchViewInput } from "./GlobalSearchView.inputs";
import { SearchFilters } from "./SearchFilters";
import { resultKey, SearchResultRow, SearchServerNotice } from "./SearchResultRows";

const SearchCalendar = lazy(async () => import("./SearchCalendar"));

/** Search presentation consumes the session and resource snapshots without loading data. */
export function renderGlobalSearchView(props: renderGlobalSearchViewInput) {
  return (
    <View style={styles.root} testID="sidebar-search">
      <SearchOverlayHeader
        accessibilityLabel="Search all messages"
        backAccessibilityLabel="Back to threads"
        fieldTestID="expanded-thread-search-field"
        focusOnMount={props.autoFocus}
        onBack={props.close}
        onChangeText={props.setText}
        onFocus={props.didFocus}
        onSubmit={props.search}
        placeholder="Search messages"
        rowTestID="global-search-header-row"
        testID="search-top-input"
        trailing={
          <ContentMenu
            align="end"
            onOpenChange={props.setFilters}
            open={props.filters}
            placement="bottom"
            trigger={
              <ThreadListHeaderAction
                accessibilityLabel="Search filters"
                accessibilityState={{ expanded: props.filters, selected: props.filterCount > 0 }}
                name={props.filterCount > 0 ? "filter" : "filter-outline"}
                onPress={props.toggleFilters}
              >
                {props.filterCount > 0 && <View style={styles.filterDot} />}
              </ThreadListHeaderAction>
            }
            width={Math.min(320, props.window.width - spacing.lg * 2)}
          >
            <View
              style={{ maxHeight: Math.max(controlSize.regular * 3, props.window.height * 0.65) }}
            >
              <View style={styles.filterHeader}>
                <Text style={styles.title}>Filters</Text>
                <Pressable
                  accessibilityLabel="Reset search filters"
                  onPress={props.resetFilters}
                  style={styles.reset}
                >
                  <Text style={styles.label}>Reset</Text>
                </Pressable>
              </View>
              {props.filterError !== null && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {props.filterError}
                </Text>
              )}
              <SearchFilters
                onChange={props.setFilterValue}
                onPickDate={props.pickDate}
                projects={props.props.projects}
                servers={props.props.servers}
                threads={props.props.threads}
                value={props.filterValue}
              />
              <Pressable
                accessibilityLabel="Apply search filters"
                accessibilityRole="button"
                onPress={props.search}
                style={styles.apply}
              >
                <Text style={styles.title}>Apply</Text>
              </Pressable>
            </View>
          </ContentMenu>
        }
        value={props.text}
      />
      {props.calendar !== null && (
        <Suspense fallback={null}>
          <SearchCalendar
            onDismiss={props.dismissCalendar}
            onSelect={props.selectCalendarDay}
            value={props.filterValue[props.calendar]}
          />
        </Suspense>
      )}
      {props.resource.status === "loading" && props.request?.kind === "initial" && (
        <WaveText style={styles.notice} text="Searching messages" />
      )}
      {props.resource.error !== null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.resource.error}
        </Text>
      )}
      {props.notices.map((server) => (
        <SearchServerNotice
          key={server.connectionId}
          name={serverName(props.props.servers, server.connectionId)}
          result={server}
        />
      ))}
      <LegendList
        data={props.results}
        initialScrollOffset={props.session.scrollOffset}
        key={String(props.request?.revision ?? 0)}
        keyboardShouldPersistTaps="handled"
        keyExtractor={resultKey}
        ListEmptyComponent={
          props.resource.status !== "loading" && !props.failed ? (
            <View style={styles.empty}>
              <Text style={styles.title}>
                {props.request === null ? "Find a message" : "No matches"}
              </Text>
              <Text style={styles.label}>
                {props.request === null
                  ? "Search titles and message history across your chats."
                  : "Try different words or fewer filters."}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          props.resource.status === "loading" && props.request?.kind === "continuation" ? (
            <WaveText style={styles.notice} text="Loading more results" />
          ) : null
        }
        onEndReached={props.loadMore}
        onEndReachedThreshold={0.4}
        onScroll={props.saveOffset}
        recycleItems
        renderItem={(entry) => (
          <SearchResultRow
            onSelect={props.selectResult}
            query={props.request?.text ?? ""}
            target={entry.item}
          />
        )}
        scrollEventThrottle={100}
        style={styles.list}
        testID="global-search-results"
      />
    </View>
  );
}

function serverName(
  servers: readonly { readonly id: string; readonly name: string }[],
  connectionId: string,
): string {
  const name = servers.find((candidate) => candidate.id === connectionId)?.name;
  return name === undefined || name === "" ? "Server" : name;
}
