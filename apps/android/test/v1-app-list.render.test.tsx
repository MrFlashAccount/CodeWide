import { LegendList } from "@legendapp/list/react-native";
import { render } from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { StyleSheet, Text } from "react-native";
import { AppList } from "../src/ui/AppList";
import { AppListItem } from "../src/ui/AppListItem";
import { colors, radii } from "../src/theme";

const EMPTY_ITEMS: readonly string[] = [];

it("owns grouped item geometry without virtualization", () => {
  const view = render(<Fixture items={["one", "two"]} />);

  expect(rowSurfaceStyle(view.getByTestId("row-one"))).toMatchObject({
    borderTopLeftRadius: radii.medium,
  });
  expect(rowSurfaceStyle(view.getByTestId("row-one")).borderBottomLeftRadius).not.toBe(
    radii.medium,
  );
  expect(rowSurfaceStyle(view.getByTestId("row-two"))).toMatchObject({
    borderBottomLeftRadius: radii.medium,
  });

  view.rerender(<Fixture items={["one", "two", "three"]} />);

  expect(rowSurfaceStyle(view.getByTestId("row-two")).borderBottomLeftRadius).not.toBe(
    radii.medium,
  );
  expect(rowSurfaceStyle(view.getByTestId("row-three"))).toMatchObject({
    borderBottomLeftRadius: radii.medium,
  });
});

it("recomputes grouped item geometry through windowed virtualization", () => {
  const view = render(<VirtualizedFixture items={["one", "two"]} />);

  expect(view.UNSAFE_getByType(LegendList).props.data).toEqual(["one", "two"]);
  expect(rowSurfaceStyle(view.getByTestId("row-two")).borderBottomLeftRadius).toBe(radii.medium);

  view.rerender(<VirtualizedFixture items={["one", "two", "three"]} />);

  expect(rowSurfaceStyle(view.getByTestId("row-two")).borderBottomLeftRadius).not.toBe(
    radii.medium,
  );
  expect(rowSurfaceStyle(view.getByTestId("row-three")).borderBottomLeftRadius).toBe(radii.medium);
});

it("renders header, empty state and footer in the non-virtualized mode", () => {
  const view = render(
    <AppList
      data={EMPTY_ITEMS}
      empty={<Text>Nothing here</Text>}
      footer={<Text>Footer</Text>}
      header={<Text>Header</Text>}
      keyExtractor={(item) => item}
      renderItem={({ item }) => <AppListItem title={item} />}
      virtualized={false}
    />,
  );

  expect(view.getByText("Header")).toBeOnTheScreen();
  expect(view.getByText("Nothing here")).toBeOnTheScreen();
  expect(view.getByText("Footer")).toBeOnTheScreen();
});

function Fixture({ items }: { readonly items: readonly string[] }): React.JSX.Element {
  return (
    <AppList
      data={items}
      keyExtractor={(item) => item}
      renderItem={({ item }) => <AppListItem testID={`row-${item}`} title={item} />}
      virtualized={false}
    />
  );
}

function VirtualizedFixture({ items }: { readonly items: readonly string[] }): React.JSX.Element {
  return (
    <AppList
      data={items}
      keyExtractor={(item) => item}
      renderItem={({ item }) => <AppListItem testID={`row-${item}`} title={item} />}
      virtualized
    />
  );
}

function rowSurface(row: ReactTestInstance): ReactTestInstance {
  let candidate = row.parent;
  while (candidate !== null) {
    const style = StyleSheet.flatten(candidate.props.style);
    if (style?.backgroundColor === colors.surfaceContainer && style.width === "100%") {
      return candidate;
    }
    candidate = candidate.parent;
  }
  throw new Error("AppList item surface was not rendered");
}

function rowSurfaceStyle(row: ReactTestInstance): Record<string, unknown> {
  return StyleSheet.flatten(rowSurface(row).props.style);
}
