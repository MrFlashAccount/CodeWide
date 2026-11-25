import { render } from "@testing-library/react-native";
import { Image } from "react-native";
import { Path } from "react-native-svg";

import { ForgeIcon } from "../src/ui/ForgeIcon";

const hidden = { includeHiddenElements: true } as const;
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

it("draws a plugin glyph as one path tinted with the theme color", () => {
  const view = render(
    <ForgeIcon
      color="#123456"
      icon={{ kind: "glyph", path: "M12 3L21 20H3Z", viewBox: "0 0 48 16" }}
      size={20}
    />,
  );
  expect(view.getByTestId("forge-icon-glyph", hidden)).toHaveStyle({ height: 20, width: 20 });
  const path = view.UNSAFE_getByType(Path);
  expect(path.props).toMatchObject({ d: "M12 3L21 20H3Z", fill: "#123456" });
  expect(view.queryByText("git-pull-request-outline", hidden)).toBeNull();
});

it("shows a raster image untinted from its data uri at the requested size", () => {
  const view = render(
    <ForgeIcon
      color="#123456"
      icon={{ dataBase64: PNG, kind: "image", mimeType: "image/png" }}
      size={18}
    />,
  );
  expect(view.getByTestId("forge-icon-image", hidden)).toBeTruthy();
  const image = view.UNSAFE_getByType(Image);
  expect(image.props.source).toEqual({ uri: `data:image/png;base64,${PNG}` });
  expect(image.props.resizeMode).toBe("contain");
  expect(image.props.style).toEqual({ height: 18, width: 18 });
  expect(image.props.tintColor).toBeUndefined();
});

it("shows the neutral icon without a provider icon and stays decorative", () => {
  const view = render(<ForgeIcon icon={null} size={16} />);
  const slot = view.getByTestId("forge-icon-generic", hidden);
  expect(slot.props.accessibilityElementsHidden).toBe(true);
  expect(slot.props.importantForAccessibility).toBe("no-hide-descendants");
  expect(view.getByText("git-pull-request-outline", hidden)).toBeTruthy();
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
});

it("falls back to the neutral icon when a plugin SVG cannot be parsed", () => {
  const view = render(
    <ForgeIcon
      icon={{
        dataBase64: Buffer.from("<svg><path d=", "utf8").toString("base64"),
        kind: "image",
        mimeType: "image/svg+xml",
      }}
    />,
  );
  expect(view.getByTestId("forge-icon-image", hidden)).toBeTruthy();
  expect(view.getByText("git-pull-request-outline", hidden)).toBeTruthy();
});

it("draws a plugin SVG image from its decoded markup", () => {
  const svg = '<svg viewBox="0 0 24 24"><path d="M1 1L23 23" fill="#ff0000"/></svg>';
  const view = render(
    <ForgeIcon
      icon={{
        dataBase64: Buffer.from(svg, "utf8").toString("base64"),
        kind: "image",
        mimeType: "image/svg+xml",
      }}
    />,
  );
  expect(view.getByTestId("forge-icon-image", hidden)).toBeTruthy();
  expect(view.UNSAFE_getByType(Path).props).toMatchObject({ d: "M1 1L23 23", fill: "#ff0000" });
  expect(view.queryByText("git-pull-request-outline", hidden)).toBeNull();
});
