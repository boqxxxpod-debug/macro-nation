import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-*/**",
      "coverage/**",
      "docs/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["packages/simulation-engine/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "indexedDB",
        "localStorage",
      ],
      "no-restricted-properties": [
        "error",
        {
          "object": "Math",
          "property": "random",
          "message": "Simulation Engine randomness must come from a seeded provider.",
        },
        {
          "object": "Date",
          "property": "now",
          "message": "Simulation Engine must not read wall-clock time.",
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          "paths": [
            { "name": "react", "message": "Simulation Engine must remain UI independent." },
            { "name": "react-dom", "message": "Simulation Engine must remain UI independent." },
            { "name": "dexie", "message": "Persistence belongs to a Web adapter." }
          ]
        }
      ]
    }
  }
);
