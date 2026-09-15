import { useLiveQuery } from "@tanstack/react-db";
import { getUserPreferencesDatabase } from "../../data/user-preferences-database";
import { useEvent } from "../../react/useEvent";
import {
  decodeProjectOrder,
  moveSidebarProject,
  SIDEBAR_PROJECT_ORDER_ID,
} from "./sidebarProjectOrder";

const database = getUserPreferencesDatabase();

/** Returns persisted sidebar project order with mutation and reset actions. */
export function useSidebarProjectOrder() {
  const query = useLiveQuery(() => database.collection);
  const order = decodeProjectOrder(
    query.data?.find((row) => row.id === SIDEBAR_PROJECT_ORDER_ID)?.value,
  );
  const move = useEvent(async (visibleKeys: readonly string[], key: string, direction: -1 | 1) => {
    await database.update(SIDEBAR_PROJECT_ORDER_ID, (value) =>
      JSON.stringify(moveSidebarProject(decodeProjectOrder(value), visibleKeys, key, direction)),
    );
  });
  return { order, move };
}
