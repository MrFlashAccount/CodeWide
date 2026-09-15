import { useId, useState } from "react";
import { useEvent } from "../../react/useEvent";
import { SearchSession } from "./search-session";

/** Search focus and visibility belong to the mounted workspace session. */
export function useSearchWorkspace() {
  const searchSessionId = useId();

  const [searchSession] = useState(() => new SearchSession(searchSessionId));

  const [searchVisible, setSearchVisible] = useState(false);

  const openGlobalSearch = useEvent(() => {
    searchSession.requestFocus();
    setSearchVisible(true);
  });

  const closeGlobalSearch = useEvent(() => setSearchVisible(false));
  return { searchSession, searchVisible, openGlobalSearch, closeGlobalSearch };
}
