// ESLint flat config for the whole monorepo. Each workspace package runs `eslint .`
// (turbo run lint); this root file applies to all of them. Correctness rules only:
// no stylistic or formatting rules.

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      // Workflow modules use orchestrator-injected globals (for example, args and log), not a standalone Node execution context.
      "packages/agents/builtin/workflows/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // `_`-prefixed names mark intentionally unused parameters and bindings.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // Deep relative imports break on every move: use the aliases instead
    // (apps/api: #common/*, #modules/* in package.json "imports"; apps/portal: @/*).
    files: ["apps/api/src/**/*.ts", "apps/portal/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^(\\.\\./){2,}", message: "Import through #common/*, #modules/* (api) or @/* (portal) instead of climbing two or more folders." }] },
      ],
    },
  },
  {
    files: ["apps/portal/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
