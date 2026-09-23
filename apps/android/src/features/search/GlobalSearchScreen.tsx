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
import { SearchOverlayMotion } from "./SearchOverlayMotion";
import { useSearchOverlayMotion } from "./searchOverlayMotion";

import { searchDateBoundary } from "../../data/message-search";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { useAsyncResource } from "../../rendering/async-resource-store";
import { AppVoiceInputProvider } from "../../ui/VoiceInputRuntime";
import type { SearchDateField, SearchFilterValue } from "./SearchFilters";

/** Public located-result contract; private search views share its single target shape. */
export type LocatedSearchHit = SearchResultTarget;

/** Global indexed search is isolated from the live conversation's resident window. */
export function GlobalSearchScreen(props: SearchScreenProps) {
  const session = props.session;
  const text = useSelector(() => session.text$.get());
  const filterValue = useSelector<SearchFilterValue>(() => session.filters$.get());
  const request = useSelector(() => session.request$.get());
  const filterError = useSelector(() => session.error$.get());
  const feed = useSelector(() => session.results.snapshot$.get());
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
    if (calendar === null) {
      return;
    }
    session.filters$[calendar].set(day);
    dismissCalendar();
  });
  const autoFocus = useConstant(() => session.shouldFocus());
  const window = useWindowDimensions();
  const search = useEvent(() => {
    if (!session.submit()) {
      if (session.error$.peek() !== null) {
        setFilters(true);
      }
      return;
    }
    setFilters(false);
    Keyboard.dismiss();
  });
  const setText = useEvent((value: string) => {
    session.changeText(value);
  });
  const clear = useEvent(() => {
    session.changeText("");
  });
  const didFocus = () => {
    session.didFocus();
  };
  const setFilterValue = useEvent((value: SearchFilterValue): void => {
    session.filters$.set(value);
  });
  const closeRoute = useEvent(() => {
    session.cancelPending();
    Keyboard.dismiss();
    props.onClose();
  });
  const overlay = useSearchOverlayMotion(closeRoute);
  const resetFilters = () => {
    session.filters$.set({ from: "", project: "", serverId: "", threadId: "", until: "" });
    session.error$.set(null);
  };
  const resource = useAsyncResource<readonly ServerSearchResult[]>(
    request === null ? null : `sidebar-search:${session.id}`,
    JSON.stringify(request),
    async () => {
      if (request === null) {
        return [];
      }
      const project = request.project.trim();
      const query = {
        from: searchDateBoundary(request.from, false),
        project: project === "" ? null : project,
        query: request.text,
        threadId: request.threadId === "" ? null : request.threadId,
        until: searchDateBoundary(request.until, true),
      };
      if (query.from !== null && query.until !== null && query.from >= query.until) {
        throw new Error("The start date must precede the end date");
      }
      const activeServers = props.servers.flatMap((server) => {
        if (request.serverId !== "" && server.id !== request.serverId) {
          return [];
        }
        const offset = request.kind === "initial" ? 0 : request.offsets[server.id];
        return offset === undefined ? [] : [{ offset, server }];
      });
      const serverResults = await Promise.all(
        activeServers.map(async ({ offset, server }): Promise<ServerSearchResult> => {
          try {
            return {
              connectionId: server.id,
              page: await props.remote.searchMessages(server.id, { ...query, offset }),
              status: "ready",
            };
          } catch (error) {
            return {
              connectionId: server.id,
              message: error instanceof Error ? error.message : "Search failed",
              status: "error",
            };
          }
        }),
      );
      session.acceptPage(request, serverResults);
      return serverResults;
    },
  );
  const loadMore = useEvent(() => {
    session.loadMore();
  });
  const toggleFilters = () => {
    const open = !filters;
    setFilters(open);
    if (open) {
      Keyboard.dismiss();
    }
  };
  const selectResult = useEvent((target: LocatedSearchHit) => {
    Keyboard.dismiss();
    props.onOpenThread(target, request?.text ?? "");
  });
  const saveOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    session.rememberScroll(event.nativeEvent.contentOffset.y);
  };
  const filterCount = [
    filterValue.from,
    filterValue.project,
    filterValue.serverId,
    filterValue.threadId,
    filterValue.until,
  ].filter((value) => value.trim() !== "").length;
  const failed =
    resource.error !== null || feed.notices.some((server) => server.status === "error");
  const view = renderGlobalSearchView({
    autoFocus,
    calendar,
    clear,
    close: overlay.close,
    didFocus,
    dismissCalendar,
    failed,
    filterCount,
    filterError,
    filters,
    filterValue,
    loadMore,
    notices: feed.notices,
    pickDate,
    props,
    request,
    resetFilters,
    resource,
    results: feed.hits,
    saveOffset,
    search,
    selectCalendarDay,
    selectResult,
    session,
    setFilters,
    setFilterValue,
    setText,
    text,
    toggleFilters,
    window,
  });
  return (
    <AppVoiceInputProvider runtime={props.voiceRuntime}>
      <SearchOverlayMotion onBackdropPress={overlay.close} progress={overlay.progress}>
        {view}
      </SearchOverlayMotion>
    </AppVoiceInputProvider>
  );
}
