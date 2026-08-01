import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, but matched at ANY depth.
    //
    // The bare ".next/**" only covers the one at the project root. A build run
    // while Turbopack had inferred a different workspace root wrote its output
    // to src/.next instead, and 16 MB of generated chunks then linted as source
    // — 295 errors and 6,162 warnings that had nothing to do with this codebase.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    "*.js",

    // Vendored third-party assets served verbatim. `public/mediapipe/wasm`
    // holds Emscripten glue code, which is generated, minified, and produced
    // every one of this project's lint errors — require() imports, `this`
    // aliasing, and a false "React Hook" match on `GLctx.useProgram`. None of
    // it is ours to fix, and linting build output hid the signal from the
    // source that is.
    "public/**",

    // A stray nested install; the real dependency tree is node_modules/.
    "*-deps/**",
  ]),
]);

export default eslintConfig;
