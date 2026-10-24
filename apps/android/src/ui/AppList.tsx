import { LegendList } from "@legendapp/list/react-native";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, type ScrollViewProps } from "react-native";
import { AppListItemContext, type AppListItemState } from "./appListItemContext";

type AppListRenderItemInfo<ItemT> = {
  readonly index: number;
  readonly item: ItemT;
};

type AppListScrollComponent = (props: ScrollViewProps) => ReactElement | null;

type AppListCommonProps<ItemT> = {
  readonly contentContainerStyle?: NonNullable<ScrollViewProps["contentContainerStyle"]>;
  readonly data: readonly ItemT[];
  readonly empty?: ReactElement | null;
  readonly footer?: ReactElement | null;
  readonly header?: ReactElement | null;
  readonly keyboardShouldPersistTaps?: NonNullable<ScrollViewProps["keyboardShouldPersistTaps"]>;
  readonly keyExtractor: (item: ItemT, index: number) => string;
  readonly nestedScrollEnabled?: boolean;
  readonly renderItem: (info: AppListRenderItemInfo<ItemT>) => ReactElement | null;
  readonly showsVerticalScrollIndicator?: boolean;
  readonly style?: NonNullable<ScrollViewProps["style"]>;
  readonly testID?: string;
};

type AppListProps<ItemT> = AppListCommonProps<ItemT> &
  (
    | {
        readonly scrollComponent?: AppListScrollComponent;
        readonly virtualized: false;
      }
    | {
        /** Optional native scroll host used by sheets and other gesture owners. */
        readonly scrollComponent?: AppListScrollComponent;
        readonly virtualized: true;
      }
  );

/** Renders a standard row list through LegendList or a plain ScrollView. */
export function AppList<ItemT>(props: AppListProps<ItemT>): ReactElement {
  return props.virtualized ? <VirtualizedAppList props={props} /> : <StaticAppList props={props} />;
}

function VirtualizedAppList<ItemT>({
  props,
}: {
  readonly props: Extract<AppListProps<ItemT>, { readonly virtualized: true }>;
}): ReactElement {
  const itemCount = props.data.length;
  const renderItem = ({ index, item }: AppListRenderItemInfo<ItemT>) => (
    <ItemStateProvider index={index} isLast={index === itemCount - 1}>
      {props.renderItem({ index, item })}
    </ItemStateProvider>
  );
  const renderScrollComponent = (scrollProps: ScrollViewProps) =>
    props.scrollComponent?.(scrollProps) ?? <ScrollView {...scrollProps} />;
  return (
    <LegendList
      contentContainerStyle={props.contentContainerStyle}
      data={props.data}
      extraData={itemCount}
      keyboardShouldPersistTaps={props.keyboardShouldPersistTaps}
      keyExtractor={props.keyExtractor}
      ListEmptyComponent={props.empty ?? null}
      ListFooterComponent={props.footer ?? null}
      ListHeaderComponent={props.header ?? null}
      nestedScrollEnabled={props.nestedScrollEnabled}
      renderItem={renderItem}
      {...(props.scrollComponent === undefined ? {} : { renderScrollComponent })}
      showsVerticalScrollIndicator={props.showsVerticalScrollIndicator}
      style={[styles.frame, props.style]}
      testID={props.testID}
    />
  );
}

function StaticAppList<ItemT>({
  props,
}: {
  readonly props: Extract<AppListProps<ItemT>, { readonly virtualized: false }>;
}): ReactElement {
  const itemCount = props.data.length;
  const children = (
    <>
      {props.header}
      {itemCount === 0
        ? props.empty
        : props.data.map((item, index) => (
            <ItemStateProvider
              index={index}
              isLast={index === itemCount - 1}
              key={props.keyExtractor(item, index)}
            >
              {props.renderItem({ index, item })}
            </ItemStateProvider>
          ))}
      {props.footer}
    </>
  );
  const scrollProps = appListScrollProps(props, children);
  return props.scrollComponent?.(scrollProps) ?? <ScrollView {...scrollProps} />;
}

function ItemStateProvider({
  children,
  index,
  isLast,
}: {
  readonly children: ReactElement | null;
  readonly index: number;
  readonly isLast: boolean;
}): ReactElement {
  const position = itemPosition(index, isLast);
  return (
    <AppListItemContext.Provider value={{ index, isLast, position }}>
      {children}
    </AppListItemContext.Provider>
  );
}

function itemPosition(index: number, isLast: boolean): AppListItemState["position"] {
  if (index === 0) {
    return isLast ? "only" : "first";
  }
  return isLast ? "last" : "middle";
}

function appListScrollProps<ItemT>(
  props: AppListCommonProps<ItemT>,
  children: ReactElement,
): ScrollViewProps {
  return {
    children,
    ...(props.contentContainerStyle === undefined
      ? {}
      : { contentContainerStyle: props.contentContainerStyle }),
    ...(props.keyboardShouldPersistTaps === undefined
      ? {}
      : { keyboardShouldPersistTaps: props.keyboardShouldPersistTaps }),
    ...(props.nestedScrollEnabled === undefined
      ? {}
      : { nestedScrollEnabled: props.nestedScrollEnabled }),
    ...(props.showsVerticalScrollIndicator === undefined
      ? {}
      : { showsVerticalScrollIndicator: props.showsVerticalScrollIndicator }),
    ...(props.style === undefined ? {} : { style: props.style }),
    ...(props.testID === undefined ? {} : { testID: props.testID }),
  };
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
});
