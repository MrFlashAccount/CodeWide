import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import {
  Keyboard,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { SearchScreenProps } from "./globalSearchContract";
import { renderGlobalSearchView } from "./GlobalSearchView";
import type { SearchResultTarget, ServerSearchResult } from "./searchResultTypes";

import { searchDateBoundary } from "../../data/message-search";
import { useEvent } from "../../react/useEvent";
import { useAsyncResource } from "../../rendering/async-resource-store";
import { type SearchDateField, type SearchFilterValue } from "./SearchFilters";

/** Public located-result contract; private search views share its single target shape. */
export type LocatedSearchHit = SearchResultTarget;

/** Global indexed search is isolated from the live conversation's resident window. */
export function GlobalSearchScreen(props: SearchScreenProps) {
  const session = props.session;
  const text = useSelector(() => session.text$.get());
  const filterValue = useSelector(() => session.filters$.get());
  const request = useSelector(() => session.request$.get());
  const filterError = useSelector(() => session.error$.get());
  const [filters, setFilters] = useState(false);
  const [calendar, setCalendar] = useState<SearchDateField | null>(null);
  const pickDate = (field: SearchDateField) => {
    setFilters(false);
    setCalendar(field);
  };
  const dismissCalendar = useEvent(() => {
    setCalendar(null);
    setFilters(true);
  });
  const selectCalendarDay = useEvent((day: string) => {
    if (calendar === null) return;
    session.filters$[calendar].set(day);
    dismissCalendar();
  });
  const [autoFocus] = useState(() => session.shouldFocus());
  const window = useWindowDimensions();
  const search = useEvent(() => {
    if (!session.submit()) {
      if (session.error$.peek() !== null) setFilters(true);
      return;
    }
    setFilters(false);
    Keyboard.dismiss();
  });
  const setText = useEvent((value: string) => session.changeText(value));
  const didFocus = () => session.didFocus();
  const setFilterValue = useEvent((value: SearchFilterValue) => session.filters$.set(value));
  const close = useEvent(() => {
    session.cancelPending();
    Keyboard.dismiss();
    props.onClose();
  });
  const resetFilters = () => {
    session.filters$.set({ serverId: "", project: "", threadId: "", from: "", until: "" });
    session.error$.set(null);
  };
  const resource = useAsyncResource<readonly ServerSearchResult[]>(
    request === null ? null : `sidebar-search:${session.id}`,
    JSON.stringify(request),
    async () => {
      if (request === null) return [];
      const query = {
        query: request.text,
        project: request.project.trim() || null,
        threadId: request.threadId || null,
        from: searchDateBoundary(request.from, false),
        until: searchDateBoundary(request.until, true),
        offset: request.page * 30,
      };
      if (query.from !== null && query.until !== null && query.from >= query.until)
        throw new Error("The start date must precede the end date");
      return await Promise.all(
        props.servers
          .filter((server) => request.serverId === "" || server.id === request.serverId)
          .map(async (server): Promise<ServerSearchResult> => {
            try {
              return {
                status: "ready",
                connectionId: server.id,
                page: await props.remote.searchMessages(server.id, query),
              };
            } catch (cause) {
              return {
                status: "error",
                connectionId: server.id,
                message: cause instanceof Error ? cause.message : "Search failed",
              };
            }
          }),
      );
    },
  );
  const results: LocatedSearchHit[] = [];
  for (const server of resource.value ?? []) {
    if (server.status === "ready")
      for (const hit of server.page.data) results.push({ connectionId: server.connectionId, hit });
  }
  results.sort((left, right) => right.hit.timestamp.localeCompare(left.hit.timestamp));
  const nextPage = useEvent(() => session.changePage(1));
  const previousPage = useEvent(() => session.changePage(-1));
  const toggleFilters = () => setFilters(!filters);
  const selectResult = useEvent((target: LocatedSearchHit) => {
    Keyboard.dismiss();
    props.onOpenThread(target, request?.text ?? "");
  });
  const saveOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    session.rememberScroll(event.nativeEvent.contentOffset.y);
  const filterCount = Object.values(filterValue).filter((value) => value.trim() !== "").length;
  const failed =
    resource.error !== null || resource.value?.some((server) => server.status === "error") === true;
  return renderGlobalSearchView({
    text,
    setText,
    search,
    autoFocus,
    didFocus,
    close,
    filters,
    setFilters,
    window,
    toggleFilters,
    filterCount,
    resetFilters,
    filterError,
    filterValue,
    setFilterValue,
    props,
    pickDate,
    calendar,
    selectCalendarDay,
    dismissCalendar,
    resource,
    request,
    results,
    selectResult,
    session,
    saveOffset,
    failed,
    previousPage,
    nextPage,
  });
}
