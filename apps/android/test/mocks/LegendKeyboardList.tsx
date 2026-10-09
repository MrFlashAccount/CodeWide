import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useLayoutEffect,
  type ForwardedRef,
  type ReactElement,
} from "react";
import { View } from "react-native";

export const legendListScrollToEnd = jest.fn(async () => undefined);
export const legendListScrollToIndex = jest.fn(async () => undefined);
export const legendListScrollToOffset = jest.fn(async () => undefined);
export const legendListIsAtEnd = jest.fn(() => true);
let withinEndThreshold = true;
let anchorReadyDuringLayout = false;
let itemViewportTop: number | null = -100;
let viewportHeight = 600;
const endThresholdListeners = new Set<(withinThreshold: boolean) => void>();

export function setLegendListAnchorReadyDuringLayout(enabled: boolean): void {
  anchorReadyDuringLayout = enabled;
}

export function setLegendListItemViewport(top: number | null, height = 600): void {
  itemViewportTop = top;
  viewportHeight = height;
}

export function setLegendListWithinEndThreshold(withinThreshold: boolean): void {
  withinEndThreshold = withinThreshold;
  for (const listener of endThresholdListeners) {
    listener(withinThreshold);
  }
}

type MockRowProps = {
  readonly data: unknown;
  readonly extraData: unknown;
  readonly index: number;
  readonly item: unknown;
  readonly render: (item: unknown, index: number, extraData: unknown) => ReactElement | null;
};

/**
 * Like LegendList (`useMemo(..., [itemKey, data, extraData])` around
 * `renderItem`), a row re-renders only when its item, the data array or
 * `extraData` change; a new `renderItem` closure alone keeps the old row.
 */
const MockRow = memo(
  function MockRow({ extraData, index, item, render }: MockRowProps): ReactElement | null {
    return render(item, index, extraData);
  },
  (previous, next) =>
    previous.item === next.item &&
    previous.data === next.data &&
    previous.extraData === next.extraData &&
    previous.index === next.index,
);

function KeyboardAwareLegendListInner<ItemT>(
  props: LegendListProps<ItemT>,
  ref: ForwardedRef<LegendListRef>,
): ReactElement {
  const {
    data,
    ListEmptyComponent,
    ListFooterComponent,
    ListHeaderComponent,
    renderItem,
    ...viewProps
  } = props;
  useImperativeHandle(
    ref,
    // WHY: The test double implements only the imperative methods exercised by presentation tests.
    () =>
      ({
        clearCaches: () => undefined,
        getNativeScrollRef: () => ({
          measureInWindow: (
            callback: (x: number, y: number, width: number, height: number) => void,
          ) => callback(0, 100, 400, viewportHeight),
        }),
        getState: () =>
          ({
            contentLength: data.length * 480,
            end: Math.max(0, data.length - 1),
            elementAtIndex: () =>
              itemViewportTop === null
                ? undefined
                : {
                    measureInWindow: (
                      callback: (x: number, y: number, width: number, height: number) => void,
                    ) => callback(0, 100 + (itemViewportTop ?? 0), 400, 1200),
                  },
            indexByKey: (key: string) => {
              const index = data.findIndex(
                (item, itemIndex) => props.keyExtractor?.(item, itemIndex) === key,
              );
              return index < 0 ? undefined : index;
            },
            positionByKey: (key: string) =>
              data.findIndex((item, index) => props.keyExtractor?.(item, index) === key) * 480,
            isAtEnd: legendListIsAtEnd(),
            isWithinMaintainScrollAtEndThreshold: withinEndThreshold,
            listen: (_listenerType: string, listener: (withinThreshold: boolean) => void) => {
              endThresholdListeners.add(listener);
              return () => endThresholdListeners.delete(listener);
            },
            scroll: 100,
            scrollLength: 600,
            start: 0,
          }) as ReturnType<LegendListRef["getState"]>,
        scrollToEnd: legendListScrollToEnd,
        scrollToIndex: legendListScrollToIndex,
        scrollToOffset: legendListScrollToOffset,
      }) as LegendListRef,
    [data, props.keyExtractor],
  );
  useLayoutEffect(() => {
    const anchor = props.anchoredEndSpace;
    if (!anchorReadyDuringLayout || anchor === undefined) return;
    const item = data[anchor.anchorIndex];
    anchor.onReady?.({
      anchorIndex: anchor.anchorIndex,
      anchorKey: item === undefined ? undefined : props.keyExtractor?.(item, anchor.anchorIndex),
      size: 0,
    });
  }, [data, props.anchoredEndSpace, props.keyExtractor]);
  const empty =
    typeof ListEmptyComponent === "function" ? <ListEmptyComponent /> : ListEmptyComponent;
  const header =
    typeof ListHeaderComponent === "function" ? <ListHeaderComponent /> : ListHeaderComponent;
  const footer =
    typeof ListFooterComponent === "function" ? <ListFooterComponent /> : ListFooterComponent;
  return (
    <View {...viewProps}>
      {header}
      {data.length === 0
        ? empty
        : data.map((item, index) => (
            <View key={props.keyExtractor?.(item, index) ?? String(index)}>
              <MockRow
                data={data}
                extraData={props.extraData}
                index={index}
                item={item}
                // WHY: rows are stored as unknown in the memoized row; this list only renders its own `data` items.
                render={(row, rowIndex, extraData) =>
                  renderItem?.({ extraData, index: rowIndex, item: row as ItemT }) ?? null
                }
              />
            </View>
          ))}
      {footer}
    </View>
  );
}

export const KeyboardAwareLegendList = forwardRef(KeyboardAwareLegendListInner);
