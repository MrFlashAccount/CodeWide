import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { lazy, Suspense } from "react";
import { Pressable, View } from "react-native";
import { colors, controlSize, iconSize, spacing } from "../../theme";
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
      <View style={styles.header} testID="search-top-input">
        <View style={styles.searchBar} testID="expanded-thread-search-field">
          <InlineIcon color={colors.textMuted} name="search" role="body" />
          <TextInput
            accessibilityLabel="Search all messages"
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
          <Pressable
            accessibilityLabel="Close search"
            accessibilityRole="button"
            onPress={props.close}
            style={styles.icon}
          >
            <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
          </Pressable>
        </View>
        <ContentMenu
          align="end"
          onOpenChange={props.setFilters}
          open={props.filters}
          placement="bottom"
          trigger={
            <Pressable
              accessibilityLabel="Search filters"
              accessibilityRole="button"
              accessibilityState={{ expanded: props.filters }}
              onPress={props.toggleFilters}
              style={styles.filterButton}
            >
              <Ionicons
                color={props.filterCount > 0 ? colors.text : colors.textMuted}
                name="options-outline"
                size={iconSize.action}
              />
              {props.filterCount > 0 && <View style={styles.filterDot} />}
            </Pressable>
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
      {props.calendar !== null && (
        <Suspense fallback={null}>
          <SearchCalendar
            onDismiss={props.dismissCalendar}
            onSelect={props.selectCalendarDay}
            value={props.filterValue[props.calendar]}
          />
        </Suspense>
      )}
      {props.resource.status === "loading" && (
        <WaveText style={styles.notice} text="Searching messages" />
      )}
      {props.resource.error !== null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.resource.error}
        </Text>
      )}
      {(props.resource.value ?? []).map((server) => (
        <SearchServerNotice
          key={server.connectionId}
          name={serverName(props.props.servers, server.connectionId)}
          result={server}
        />
      ))}
      <LegendList
        data={props.results}
        initialScrollOffset={props.session.scrollOffset}
        key={`${String(props.request?.revision ?? 0)}:${String(props.request?.page ?? 0)}`}
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
        ListHeaderComponent={
          props.results.length > 0 ? <Text style={styles.notice}>Threads & messages</Text> : null
        }
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

function serverName(
  servers: readonly { readonly id: string; readonly name: string }[],
  connectionId: string,
): string {
  const name = servers.find((candidate) => candidate.id === connectionId)?.name;
  return name === undefined || name === "" ? "Server" : name;
}
