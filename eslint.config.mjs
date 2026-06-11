import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default defineConfig([
  globalIgnores(["dist/**", "src-tauri/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // Pre-existing patterns from the Next.js era (mounted flags, localStorage
      // reads in effects); keep visible as warnings rather than failing lint.
      "react-hooks/set-state-in-effect": "warn",
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    // Node-side scripts (icon generation, configs).
    files: ["scripts/**/*.mjs", "*.config.{ts,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
