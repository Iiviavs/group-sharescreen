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
    // Vendored, already-minified third-party assets. Without this, linting
    // the repo reports dozens of warnings from public/rnnoise's minified
    // worklet — noise that buries every real finding and trains you to
    // ignore the output.
    "public/**",
  ]),
]);

export default eslintConfig;
