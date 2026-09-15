import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { lazy, Suspense } from "react";
import { Pressable, View } from "react-native";
import { colors, controlSize, iconSize, spacing } from "../../theme";
import { AppPopover } from "../../ui/AppPopover";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { styles } from "./GlobalSearchScreen.styles";
import type { renderGlobalSearchViewInput } from "./GlobalSearchView.inputs";
import { SearchFilters } from "./SearchFilters";
import { resultKey, SearchResultRow, SearchServerNotice } from "./SearchResultRows";

const SearchCalendar = lazy(() => import("./SearchCalendar"));

/** Search presentation consumes the session and resource snapshots without loading data. */
export function renderGlobalSearchView(props: renderGlobalSearchViewInput) {
  return (
    <View testID="sidebar-search" style={styles.root}>
      <View testID="search-top-input" style={styles.header}>
        <View testID="expanded-thread-search-field" style={styles.searchBar}>
          <InlineIcon name="search" color={colors.textMuted} role="body" />
          <TextInput
            compact
            accessibilityLabel="Search all messages"
            value={props.text}
            onChangeText={props.setText}
            onSubmitEditing={props.search}
            returnKeyType="search"
            placeholder="Search messages"
            autoFocus={props.autoFocus}
            onFocus={props.didFocus}
            style={styles.input}
          />
          <Pressable
            onPress={props.close}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            style={styles.icon}
          >
            <Ionicons name="close" size={iconSize.action} color={colors.textMuted} />
          </Pressable>
        </View>
        <AppPopover
          open={props.filters}
          onOpenChange={props.setFilters}
          width={Math.min(320, props.window.width - spacing.lg * 2)}
          placement="bottom"
          align="end"
          trigger={
            <Pressable
              onPress={props.toggleFilters}
              accessibilityRole="button"
              accessibilityLabel="Search filters"
              accessibilityState={{ expanded: props.filters }}
              style={styles.filterButton}
            >
              <Ionicons
                name="options-outline"
                size={iconSize.action}
                color={props.filterCount > 0 ? colors.text : colors.textMuted}
              />
              {props.filterCount > 0 && <View style={styles.filterDot} />}
            </Pressable>
          }
        >
          <View
            style={{ maxHeight: Math.max(controlSize.regular * 3, props.window.height * 0.65) }}
          >
            <View style={styles.filterHeader}>
              <Text style={styles.title}>Filters</Text>
              <Pressable
                onPress={props.resetFilters}
                accessibilityLabel="Reset search filters"
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
              value={props.filterValue}
              onChange={props.setFilterValue}
              servers={props.props.servers}
              threads={props.props.threads}
              projects={props.props.projects}
              onPickDate={props.pickDate}
            />
            <Pressable
              onPress={props.search}
              accessibilityRole="button"
              accessibilityLabel="Apply search filters"
              style={styles.apply}
            >
              <Text style={styles.title}>Apply</Text>
            </Pressable>
          </View>
        </AppPopover>
      </View>
      {props.calendar !== null && (
        <Suspense fallback={null}>
          <SearchCalendar
            value={props.filterValue[props.calendar]}
            onSelect={props.selectCalendarDay}
            onDismiss={props.dismissCalendar}
          />
        </Suspense>
      )}
      {props.resource.status === "loading" && (
        <WaveText text="Searching messages" style={styles.notice} />
      )}
      {props.resource.error !== null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.resource.error}
        </Text>
      )}
      {(props.resource.value ?? []).map((server) => (
        <SearchServerNotice
          key={server.connectionId}
          result={server}
          name={
            props.props.servers.find((candidate) => candidate.id === server.connectionId)?.name ||
            "Server"
          }
        />
      ))}
      <LegendList
        key={`${props.request?.revision ?? 0}:${props.request?.page ?? 0}`}
        data={props.results}
        renderItem={(entry) => (
          <SearchResultRow
            target={entry.item}
            query={props.request?.text ?? ""}
            onSelect={props.selectResult}
          />
        )}
        keyExtractor={resultKey}
        recycleItems
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        initialScrollOffset={props.session.scrollOffset}
        onScroll={props.saveOffset}
        scrollEventThrottle={100}
        ListHeaderComponent={
          props.results.length > 0 ? <Text style={styles.notice}>Threads & messages</Text> : null
        }
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
      />
      <View style={styles.pagination}>
        {(props.request?.page ?? 0) > 0 && (
          <Pressable onPress={props.previousPage} style={styles.reset}>
            <Text style={styles.label}>Previous</Text>
          </Pressable>
        )}
        {props.resource.value?.some(
          (server) => server.status === "ready" && server.page.nextOffset !== null,
        ) === true && (
          <Pressable onPress={props.nextPage} style={styles.reset}>
            <Text style={styles.label}>Next</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
