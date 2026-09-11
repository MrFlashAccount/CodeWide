import { useLiveQuery } from "@tanstack/react-db";
import { useEvent } from "../react/useEvent";
import { getUserPreferencesDatabase } from "./user-preferences-database";
import { decodeProjectOrder, moveSidebarProject, SIDEBAR_PROJECT_ORDER_ID } from "./sidebar-project-order";

const database = getUserPreferencesDatabase();

export function useSidebarProjectOrder() {
  const query = useLiveQuery(() => database.collection);
  const order = decodeProjectOrder(query.data?.find((row) => row.id === SIDEBAR_PROJECT_ORDER_ID)?.value);
  const move = useEvent(async (visibleKeys: readonly string[], key: string, direction: -1 | 1) => {
    await database.update(SIDEBAR_PROJECT_ORDER_ID, (value) => JSON.stringify(moveSidebarProject(decodeProjectOrder(value), visibleKeys, key, direction)));
  });
  return { order, move };
}
