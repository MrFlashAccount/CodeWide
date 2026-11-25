const { getDefaultConfig } = require("expo/metro-config");
const { getBundleModeMetroConfig } = require("react-native-worklets/bundleMode");
const { FileStore } = require("metro-cache");
const { realpathSync } = require("node:fs");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// Worklets bundle mode writes each worklet to `react-native-worklets/.worklets` of this
// checkout while transforming, and the transformed module requires that file. A transform
// cache shared through the OS temporary directory serves another checkout's output without
// the file being written here, so the cache lives inside the worklets package and shares the
// generated files' lifetime.
config.cacheStores = [
  new FileStore({
    root: path.join(
      realpathSync(path.dirname(require.resolve("react-native-worklets/package.json"))),
      ".metro-cache",
    ),
  }),
];
const legendListNativeEntry = realpathSync(
  path.join(__dirname, "node_modules/@legendapp/list/react-native.js"),
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@legendapp/list/react-native") {
    return { filePath: legendListNativeEntry, type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = getBundleModeMetroConfig(config);
