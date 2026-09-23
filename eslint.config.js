import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "apps/web/public/**",
      "e2e/screenshots/**",
      "test-results/**",
      "playwright-report/**",
      ".cache/**",
      ".playwright-cli/**",
      "output/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Unused args are common in event handlers and callbacks where the signature is fixed;
      // an underscore prefix is the explicit way to say "required by the contract, not used".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }]
    }
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    // Only the two classic rules. The React Compiler rules bundled into the v7 "recommended"
    // preset (set-state-in-effect and friends) flag most of this codebase's fetch-then-setState
    // effects, which are correct as written; turning them on now would just train everyone to
    // ignore the linter.
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    // Ambient declarations exist to be picked up by the compiler, never referenced in the file
    // that declares them — "unused" is the normal state here, not a smell.
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" }
  },
  {
    // Scripts and servers are the places where writing to stdout *is* the interface.
    files: ["scripts/**/*.mjs", "apps/api/src/**/*.ts", "**/*.test.ts", "e2e/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        performance: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        TextDecoder: "readonly",
        TextDecoderStream: "readonly",
        TextEncoder: "readonly",
        structuredClone: "readonly"
      }
    },
    rules: { "no-console": "off" }
  },
  {
    // Playwright driver scripts straddle two runtimes: the file runs in Node, but the callbacks
    // passed to `page.evaluate` are serialised and run in the browser, so both sets of globals
    // legitimately appear in the same source file.
    files: ["e2e/**/*.mjs", "scripts/render-basemap-thumbs.mjs", "scripts/*browser*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        document: "readonly",
        window: "readonly",
        getComputedStyle: "readonly",
        innerWidth: "readonly",
        innerHeight: "readonly",
        matchMedia: "readonly",
        CustomEvent: "readonly"
      }
    },
    rules: { "no-console": "off" }
  }
);
