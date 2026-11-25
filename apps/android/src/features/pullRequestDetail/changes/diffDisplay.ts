import { useLiveQuery } from "@tanstack/react-db";

import { unknownRecord } from "../../../data/unknownRecord";
import { getUserPreferencesDatabase } from "../../../data/user-preferences-database";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";

/** Device-wide reading preferences for pull request diffs. */
export type DiffDisplay = {
  readonly mode: "unified" | "split";
  readonly scrollPath: boolean;
  readonly showNumbers: boolean;
  readonly wrapLines: boolean;
};

const KEY = "pull-request-diff-display";
const defaults: DiffDisplay = {
  mode: "unified",
  scrollPath: false,
  showNumbers: true,
  wrapLines: false,
};

function decode(value: string | null | undefined): DiffDisplay {
  if (typeof value !== "string") {
    return defaults;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null) {
      return defaults;
    }
    return {
      mode: parsed.mode === "split" ? "split" : "unified",
      scrollPath: parsed.scrollPath === true,
      showNumbers: parsed.showNumbers !== false,
      wrapLines: parsed.wrapLines === true,
    };
  } catch {
    return defaults;
  }
}

/** Keeps preference writes serialized against the device's latest stored values. */
export function useDiffDisplay(): {
  readonly select: (key: string) => void;
  readonly value: DiffDisplay;
} {
  const database = getUserPreferencesDatabase();
  const query = useLiveQuery(() => database.collection);
  const value = decode(query.data?.find((row) => row.id === KEY)?.value);
  const dialog = useAppDialog();
  const select = useEvent((key: string) => {
    void database
      .update(KEY, (previous) => {
        const current = decode(previous);
        switch (key) {
          case "split":
          case "unified":
            return JSON.stringify({ ...current, mode: key });
          case "showNumbers":
          case "wrapLines":
          case "scrollPath":
            return JSON.stringify({ ...current, [key]: !current[key] });
          default:
            return JSON.stringify(current);
        }
      })
      .catch((error: unknown) => {
        dialog.error("Could not save diff settings", error);
      });
  });
  return { select, value };
}
