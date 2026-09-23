import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { lazy, Suspense } from "react";
import { Pressable, View } from "react-native";
import {
  ThreadListHeaderAction,
  ThreadListHeaderRow,
} from "../../presentation/navigation/ThreadListHeader";
import { colors, controlHitSlop, controlSize, iconSize, spacing } from "../../theme";
import { ContentMenu } from "../../ui/ContentMenu";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
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
      <ThreadListHeaderRow testID="global-search-header-row">
        <ThreadListHeaderAction
          accessibilityLabel="Back to threads"
          iconSize={iconSize.navigation}
          name="arrow-back"
          onPress={props.close}
        />
        <View style={styles.header} testID="search-top-input">
          <View style={styles.searchBar} testID="expanded-thread-search-field">
            <InlineIcon color={colors.textMuted} name="search" role="body" />
            <TextInput
              accessibilityLabel="Search all messages"
              accessibilityRole="search"
              autoFocus={props.autoFocus}
              compact
              onChangeText={props.setText}
              onFocus={props.didFocus}
              onSubmitEditing={props.search}
              placeholder="Search messages"
              returnKeyType="search"
              style={styles.input}
              value={props.text}
            />
            {props.text !== "" && (
              <Pressable
                accessibilityLabel="Clear search query"
                accessibilityRole="button"
                hitSlop={controlHitSlop.regular}
                onPress={props.clear}
                style={({ pressed }) => [styles.clearButton, pressed && styles.iconButtonPressed]}
              >
                <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
              </Pressable>
            )}
          </View>
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
        </View>
      </ThreadListHeaderRow>
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
