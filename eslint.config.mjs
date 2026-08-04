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
    // Python virtualenvs (python/tts/.venv, python/image/.venv, ...) — not
    // source, and some dependency trees (e.g. mflux pulling in matplotlib)
    // vendor JS assets that would otherwise get linted as if they were ours.
    "python/**/.venv/**",
  ]),
]);

export default eslintConfig;
