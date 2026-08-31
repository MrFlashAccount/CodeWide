import { defineHygieneConfig } from "@sergeigarin/hygene";

const V2_DOMAIN_FILES = ["src/v2/domain/**/*.ts", "src/v2/domain/**/*.tsx"];
const V2_EFFECT_BOUNDARY_FILES = ["src/boot/**", "src/v2/infrastructure/react/**"];
const V2_ENVIRONMENT_BOUNDARY_FILES = ["src/v2/infrastructure/config/readEnvironment.ts"];
const V2_CAPABILITY_CONSUMER_FILES = [
  "app/**/*.ts",
  "app/**/*.tsx",
  "src/v2/application/**/*.ts",
  "src/v2/application/**/*.tsx",
  "src/v2/features/**/*.ts",
  "src/v2/features/**/*.tsx",
  "src/v2/ui/**/*.ts",
  "src/v2/ui/**/*.tsx",
];
const V2_OWNED_FILES = [
  "app/**/*.ts",
  "app/**/*.tsx",
  "src/boot/**/*.ts",
  "src/boot/**/*.tsx",
  "src/v2/**/*.ts",
  "src/v2/**/*.tsx",
];
const STRUCTURED_CLONE_RESTRICTION = {
  message:
    "General-purpose cloning is forbidden in V2. Keep one owner and copy only the smallest structure required by an explicit boundary contract.",
  name: "structuredClone",
};
const DOMAIN_FORBIDDEN_IMPORTS = [
  "**/application/**",
  "**/features/**",
  "**/infrastructure/**",
  "**/ui/**",
  "expo",
  "expo-*",
  "react-native",
  "react-native/**",
];
const CAPABILITY_FORBIDDEN_IMPORTS = [
  "**/infrastructure/**",
  "@op-engineering/op-sqlite",
  "expo-constants",
  "expo-crypto",
  "expo-file-system",
  "expo-file-system/**",
  "expo-linking",
  "expo-secure-store",
  "expo-sqlite",
  "expo-sqlite/**",
];

const base = defineHygieneConfig({
  architecture: {
    domainFiles: V2_DOMAIN_FILES,
    domainForbiddenImportPatterns: DOMAIN_FORBIDDEN_IMPORTS,
    effectBoundaryFiles: V2_EFFECT_BOUNDARY_FILES,
    uiFiles: V2_CAPABILITY_CONSUMER_FILES,
    uiForbiddenImportPatterns: CAPABILITY_FORBIDDEN_IMPORTS,
  },
  banDirectEffects: true,
  environment: "universal",
  typeCheck: true,
});

export default {
  ...base,
  globals: {
    EventSource: "readonly",
    WebSocket: "readonly",
    fetch: "readonly",
    indexedDB: "readonly",
    localStorage: "readonly",
    sessionStorage: "readonly",
  },
  ignorePatterns: [
    ".expo/**",
    "android/**",
    "app/_layout.tsx",
    "app/index.tsx",
    "app/legacy.tsx",
    "app/pair.tsx",
    "app/thread.tsx",
    "assets/**",
    "coverage/**",
    "dist/**",
    "node_modules/**",
  ],
  jsPlugins: [
    ...base.jsPlugins,
    { name: "expo", specifier: "eslint-plugin-expo" },
    { name: "react-native", specifier: "@react-native/eslint-plugin" },
  ],
  overrides: [
    ...base.overrides,
    {
      files: V2_OWNED_FILES,
      rules: {
        "no-restricted-globals": [
          "error",
          {
            message:
              "Read Expo build/runtime environment once in src/v2/infrastructure/config/readEnvironment.ts and inject a typed project config.",
            name: "process",
          },
          STRUCTURED_CLONE_RESTRICTION,
        ],
      },
    },
    {
      files: V2_ENVIRONMENT_BOUNDARY_FILES,
      rules: {
        "no-restricted-globals": ["error", STRUCTURED_CLONE_RESTRICTION],
      },
    },
    {
      files: V2_CAPABILITY_CONSUMER_FILES,
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                message: "Use lodash-es so bundlers can tree-shake the import.",
                name: "lodash",
              },
              {
                importNames: ["AppState", "Linking", "NativeModules"],
                message:
                  "AppState, Linking, and NativeModules are infrastructure capabilities; inject a typed adapter.",
                name: "react-native",
              },
            ],
            patterns: [
              {
                group: ["lodash/*"],
                message: "Use lodash-es so bundlers can tree-shake the import.",
              },
              {
                group: CAPABILITY_FORBIDDEN_IMPORTS,
                message:
                  "UI and application code must use an injected capability instead of importing infrastructure directly.",
              },
            ],
          },
        ],
      },
    },
    {
      files: V2_OWNED_FILES,
      rules: {
        "@nkzw/no-instanceof": "off",
        "eslint/complexity": "off",
        "eslint/arrow-body-style": "off",
        "eslint/curly": "off",
        "eslint/max-params": "off",
        "eslint/no-magic-numbers": "off",
        "hygiene/require-type-assertion-justification": "off",
        "perfectionist/sort-interfaces": "off",
        "perfectionist/sort-jsx-props": "off",
        "perfectionist/sort-object-types": "off",
        "perfectionist/sort-objects": "off",
        "react/hook-use-state": "off",
        "react-doctor/async-await-in-loop": "off",
        "react-doctor/jsx-max-depth": "off",
        "react-doctor/jsx-no-constructed-context-values": "off",
        "react-doctor/jsx-no-jsx-as-prop": "off",
        "react-doctor/jsx-no-new-array-as-prop": "off",
        "react-doctor/jsx-no-new-function-as-prop": "off",
        "react-doctor/jsx-no-new-object-as-prop": "off",
        "react-doctor/only-export-components": "off",
        "typescript/method-signature-style": "off",
        "typescript/dot-notation": "off",
        "typescript/no-deprecated": "off",
        "typescript/no-unnecessary-condition": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/no-confusing-void-expression": "off",
        "typescript/promise-function-async": "off",
        "typescript/require-await": "off",
        "typescript/restrict-template-expressions": "off",
        "typescript/strict-void-return": "off",
        "typescript/unbound-method": "off",
        "unicorn/catch-error-name": "off",
      },
    },
    {
      files: ["src/v2/infrastructure/persistence/**"],
      rules: {
        "eslint/no-restricted-globals": "off",
      },
    },
  ],
  rules: {
    ...base.rules,
    "expo/no-dynamic-env-var": "error",
    "expo/no-env-var-destructuring": "error",
    "max-params": ["error", { max: 4 }],
    "react-native/no-deep-imports": "error",
    "react-native/platform-colors": "error",
  },
};
