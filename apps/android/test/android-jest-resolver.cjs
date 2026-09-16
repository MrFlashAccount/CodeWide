/** @type {import('jest-resolve').SyncResolver} */
module.exports = (request, options) => {
  let extensions = options.extensions;
  const worklets =
    options.basedir.includes("react-native-worklets") || request.includes("react-native-worklets");
  if (worklets) {
    extensions = extensions?.filter((extension) => !extension.includes("native"));
  } else {
    for (const platform of ["android", "native"]) {
      try {
        return options.defaultResolver(`${request}.${platform}`, { ...options, extensions });
      } catch {
        // Continue with the next platform candidate before the generic module.
      }
    }
  }
  if (extensions !== undefined) {
    extensions = [...extensions].sort(
      (left, right) => platformPriority(left) - platformPriority(right),
    );
  }
  return options.defaultResolver(request, { ...options, extensions });
};

function platformPriority(extension) {
  if (extension.includes("android")) return 0;
  if (extension.includes("native")) return 1;
  return 2;
}
