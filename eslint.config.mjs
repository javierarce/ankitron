import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default defineConfig([
  // Generated output, plus the Rust tree. ESLint's flat config does not read
  // .gitignore, so every generated directory has to be repeated here or eslint
  // walks into it: a stale artifact directory then fails `pnpm lint` with
  // errors from files nobody wrote, while CI's clean checkout passes. That
  // divergence also blocks `pnpm release`, which lints before tagging. The
  // build outputs below mirror .gitignore — .next/ and out/ included, since a
  // Next.js build left behind in the repo directory is what surfaced this.
  globalIgnores([
    "dist/**",
    "docs/demo/**",
    "coverage/**",
    ".next/**",
    "out/**",
    "src-tauri/**",
  ]),
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
  },
  {
    // Keep the raw AnkiConnect transport inside the domain layer: UI code goes
    // through the typed modules. Only the `ankiFetch` symbol is restricted —
    // the typed helpers that also live in anki-fetch.ts (syncCollection,
    // reloadCollection, fetchAllDueCounts, …) stay importable from anywhere.
    // src/lib/** is the domain layer itself, and tests mock the transport
    // module, so both are exempt.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/anki-fetch"],
              importNamePattern: "^ankiFetch$",
              message:
                "Import the typed API from @/lib/notes|cards|decks|review instead; raw ankiFetch lives only in src/lib.",
            },
          ],
        },
      ],
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
