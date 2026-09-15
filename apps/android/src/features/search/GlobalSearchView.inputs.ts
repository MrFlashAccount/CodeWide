import { type Dispatch, type SetStateAction } from "react";
import {
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { AsyncResourceSnapshot } from "../../rendering/async-resource-store";
import type { SearchScreenProps } from "./globalSearchContract";
import type { SearchRequest, SearchSession } from "./search-session";
import { type SearchDateField, type SearchFilterValue } from "./SearchFilters";
import type { SearchResultTarget, ServerSearchResult } from "./searchResultTypes";

export type renderGlobalSearchViewInput = {
  text: string;
  setText: (value: string) => void;
  search: () => void;
  autoFocus: boolean;
  didFocus: () => void;
  close: () => void;
  filters: boolean;
  setFilters: Dispatch<SetStateAction<boolean>>;
  window: ReturnType<typeof useWindowDimensions>;
  toggleFilters: () => void;
  filterCount: number;
  resetFilters: () => void;
  filterError: string | null;
  filterValue: SearchFilterValue;
  setFilterValue: (value: SearchFilterValue) => void;
  props: SearchScreenProps;
  pickDate: (field: SearchDateField) => void;
  calendar: SearchDateField | null;
  selectCalendarDay: (day: string) => void;
  dismissCalendar: () => void;
  resource: AsyncResourceSnapshot<readonly ServerSearchResult[]>;
  request: SearchRequest | null;
  results: SearchResultTarget[];
  selectResult: (target: SearchResultTarget) => void;
  session: SearchSession;
  saveOffset: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  failed: boolean;
  previousPage: () => void;
  nextPage: () => void;
};
