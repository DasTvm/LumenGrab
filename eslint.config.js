import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "playwright-report", "test-results", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Product rule: no raw invoke() outside src/platform (typed IPC wrappers only).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              message:
                "Use the typed wrappers in src/platform instead of calling invoke() directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/platform/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["*.config.{ts,js}"],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
