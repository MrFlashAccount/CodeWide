import type { LegendListRef } from "@legendapp/list/react-native";
import type { View } from "react-native";

type MeasurableView = Pick<View, "measureInWindow">;

type ViewMeasurement =
  | { readonly height: number; readonly status: "measured"; readonly top: number }
  | { readonly status: "unavailable" };

/** Measures the rendered row, including list padding, headers and underflow alignment. */
export async function measureTimelineItemViewport(
  list: LegendListRef | null,
  itemKey: string,
): Promise<ViewMeasurement> {
  if (list === null) {
    return { status: "unavailable" };
  }
  const state = list.getState();
  const index = state.indexByKey(itemKey);
  if (index === undefined) {
    return { status: "unavailable" };
  }
  const [item, viewport] = await Promise.all([
    measureView(state.elementAtIndex(index)),
    measureView(list.getNativeScrollRef()),
  ]);
  return relativeItemBounds(item, viewport);
}

function relativeItemBounds(item: ViewMeasurement, viewport: ViewMeasurement): ViewMeasurement {
  return item.status === "measured" && viewport.status === "measured" && viewport.height > 0
    ? { height: viewport.height, status: "measured", top: item.top - viewport.top }
    : { status: "unavailable" };
}

async function measureView(view: unknown): Promise<ViewMeasurement> {
  if (!isMeasurableView(view)) {
    return { status: "unavailable" };
  }
  return new Promise((resolve) => {
    view.measureInWindow((...[, top, , height]) => {
      resolve(
        Number.isFinite(top) && Number.isFinite(height)
          ? { height, status: "measured", top }
          : { status: "unavailable" },
      );
    });
  });
}

function isMeasurableView(view: unknown): view is MeasurableView {
  return (
    typeof view === "object" &&
    view !== null &&
    "measureInWindow" in view &&
    typeof view.measureInWindow === "function"
  );
}
