// Native viewport measurement is outside Jest. Preserve the package's real lifecycle hooks.
jest.mock("@legendapp/list/react-native", () => ({
  ...jest.requireActual("@legendapp/list/react-native"),
  LegendList: jest.requireActual("./mocks/LegendNativeList").LegendList,
}));

beforeAll(() => {
  const entry = "@legendapp/list/react-native";
  // A Jest moduleNameMapper redirects even requireActual. Anchor the reference
  // to the installed package while preserving Jest's selected platform file.
  const { realpathSync } = require("node:fs");
  const path = require("node:path");
  const packageDir = realpathSync(path.join(__dirname, "../node_modules/@legendapp/list"));
  const resolved = require.resolve(entry);
  if (path.dirname(realpathSync(resolved)) !== packageDir) {
    throw new Error("Mock only the LegendList viewport, never redirect its hook module.");
  }
  const actual = jest.requireActual(entry);
  const loaded = require("@legendapp/list/react-native");
  for (const name of Object.keys(actual).filter((key) => /^use[A-Z]/.test(key))) {
    if (loaded[name] !== actual[name]) {
      throw new Error(`Render tests must use the real LegendList hook ${name}.`);
    }
  }
});
