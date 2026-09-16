const { installExpoGlobalPolyfill } = require("expo-modules-core/src/polyfill/dangerous-internal");

global.__DEV__ = false;
installExpoGlobalPolyfill();

class RenderFileSystemValue {}

globalThis.expo.modules.FileSystem = {
  FileSystemDirectory: RenderFileSystemValue,
  FileSystemDownloadTask: RenderFileSystemValue,
  FileSystemFile: RenderFileSystemValue,
  FileSystemUploadTask: RenderFileSystemValue,
  FileSystemWatcher: RenderFileSystemValue,
  availableDiskSpace: 0,
  bundleDirectory: "file:///bundle/",
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///documents/",
  info: () => ({ exists: false }),
  totalDiskSpace: 0,
};
globalThis.expo.modules.ExpoSecureStore = {
  AFTER_FIRST_UNLOCK: 1,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
  ALWAYS: 3,
  ALWAYS_THIS_DEVICE_ONLY: 4,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 5,
  WHEN_UNLOCKED: 6,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  deleteValueWithKeyAsync: async () => undefined,
  getValueWithKeyAsync: async () => null,
  setValueWithKeyAsync: async () => undefined,
};
globalThis.expo.modules.ExponentConstants = {
  appOwnership: null,
  executionEnvironment: "bare",
  manifest: null,
  sessionId: "render-test",
};
globalThis.expo.modules.ExpoFetchModule = {};
globalThis.expo.modules.ExpoAsset = {
  downloadAsync: async (url) => url,
};
globalThis.expo.modules.ExpoSQLite = {
  NativeDatabase: class RenderSQLiteDatabase {},
  NativeSession: class RenderSQLiteSession {},
  NativeStatement: class RenderSQLiteStatement {},
  bundledExtensions: {},
  defaultDatabaseDirectory: "file:///databases/",
  ensureDatabasePathExistsAsync: async () => undefined,
  ensureDatabasePathExistsSync: () => undefined,
};
globalThis.expo.modules.ExpoUI = {
  SwitchDefaultIconSize: 0,
  ToggleButtonIconSize: 0,
  ToggleButtonIconSpacing: 0,
  ViewPrototypes: {},
  getMaterialColors: () => ({}),
  isDynamicColorAvailable: false,
};
globalThis.expo.modules.ExpoVideo = {
  VideoPlayer: class RenderVideoPlayer {},
  VideoThumbnail: class RenderVideoThumbnail {},
  clearVideoCacheAsync: async () => undefined,
  getCurrentVideoCacheSize: () => 0,
  isPictureInPictureSupported: () => false,
  setVideoCacheSizeAsync: async () => undefined,
};
globalThis.expo.modules.ExpoLibghostty = {
  releasePersistentSession: async () => undefined,
};
globalThis.expo.getViewConfig = () => ({ directEventTypes: {}, validAttributes: {} });
process.env.EXPO_OS = "web";
process.env.EXPO_PUBLIC_USE_RN_FETCH = "1";

const emptyQueryResult = { rows: [], rowsAffected: 0 };
const emptyDatabase = {
  close: () => undefined,
  execute: async () => emptyQueryResult,
  executeBatch: async () => [],
  executeRaw: async () => [],
  executeRawSync: () => [],
  executeSync: () => emptyQueryResult,
  executeWithHostObjects: async () => emptyQueryResult,
  flushPendingReactiveQueries: async () => undefined,
  prepareStatement: () => ({
    bind: async () => undefined,
    bindSync: () => undefined,
    execute: async () => emptyQueryResult,
  }),
};
global.__OPSQLiteProxy = { open: () => emptyDatabase };

const { NativeModules } = require("react-native");
NativeModules.OPSQLite = { getConstants: () => ({}) };

// WHY: Render tests exercise production telemetry scheduling, whose deferred flush must not own the Node process lifetime.
const platformSetTimeout = global.setTimeout;
global.setTimeout = (...args) => {
  const timer = platformSetTimeout(...args);
  timer.unref?.();
  return timer;
};
const platformSetInterval = global.setInterval;
global.setInterval = (...args) => {
  const timer = platformSetInterval(...args);
  timer.unref?.();
  return timer;
};
