import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MapLibre worker bundle, copied in by postinstall — not our code.
    "public/maplibre/**",
    // Playwright's own output: reports, traces and failure screenshots.
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    /*
      Playwright fixtures hand you a function called `use`, and a fixture is
      written as a plain lowercase-named function. Between them that is enough
      for the React plugin to decide `use()` is the React hook of the same name
      being called outside a component, which it is not — there is no React in
      this directory at all. Scoped to the end-to-end tests and to that one rule,
      so the check keeps working everywhere it means something.
    */
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

export default eslintConfig;
