# Vite Migration Approach

Migrate in small, reversible steps, keeping Webpack working until Vite can replace it cleanly.

## 1. Map Current Webpack Outputs

Identify every emitted asset name expected by the backend and Pug templates:

- `runtime.js`
- `vendor.js`
- `main.js`
- `noscript.js`
- CSS
- fonts
- images
- manifest keys

The important contract is `out/dist/manifest.json` plus what `lib/app/rendering.ts` resolves through `require(...)`.

### Current Findings

The current Webpack configuration lives in `webpack.config.esm.ts`.

Webpack has two explicit entrypoints:

```text
main     -> ./static/main.ts
noscript -> ./static/noscript.ts
```

Production output is written to:

```text
out/webpack/static/
```

The production manifest is written to:

```text
out/dist/manifest.json
```

Webpack's logical asset names are consumed directly by Pug via `require(...)`. The current required keys are:

```text
vendor.css
main.css
noscript.css
runtime.js
vendor.js
main.js
noscript.js
```

Those references are in:

```text
views/_layout.pug
views/noscript/layout.pug
views/noscript/share.pug
```

In production, `lib/app/static-assets.ts` loads `out/dist/manifest.json` and maps each logical asset name to its hashed
output filename. If a key is missing from the manifest, the Pug require handler logs an error and returns an empty URL.

In development, `lib/app/static-assets.ts` starts `webpack-dev-middleware` and returns plain URLs such as:

```text
/runtime.js
/vendor.js
/main.js
```

The important compatibility point for Vite is therefore not only producing equivalent files, but preserving or adapting
the logical manifest keys used by server-rendered Pug.

Current Webpack output behaviour:

- JavaScript filenames are `[name].[contenthash].js` in production and `[name].js` in development.
- CSS filenames are `[name].[contenthash].css` in production and `[name].css` in development.
- Monaco workers are `[name].worker.[contenthash].js` in production and `[name].worker.js` in development.
- `optimization.runtimeChunk = 'single'` creates the `runtime.js` logical entry expected by Pug.
- `splitChunks.cacheGroups.vendors.name = 'vendor'` creates the `vendor.js` and `vendor.css` logical entries expected by
  Pug.
- `CopyWebpackPlugin` copies `public/` into `out/webpack/static/`; production branding validation checks the copied
  assets through the manifest.
- Asset modules handle `png`, `woff`, `woff2`, `eot`, `ttf`, and `svg`, inlining assets below 8 KiB.
- The frontend TypeScript project still targets ES5, but Vite 8's Rolldown backend only supports ES2015 and later as a
  build target. The side-by-side Vite config starts with `es2015`; any remaining legacy-browser support should be handled
  as a separate compatibility decision.

Current Webpack-only loader behaviour:

- SCSS is extracted through `mini-css-extract-plugin`.
- SCSS passes through `etc/webpack/replace-golden-layout-imports.js`.
- Client-side Pug imports are compiled by `etc/webpack/parsed-pug-loader.js`.
- TypeScript is handled by `ts-loader`.
- JavaScript source maps are handled by `source-map-loader`.

Current client-side Pug imports are limited to:

```text
static/generated/changelog.pug
static/generated/cookies.pug
static/generated/privacy.pug
```

They are imported from `static/main.ts`, with the module type declared in `static/client.d.ts` as an object containing:

```ts
{
    hash: string;
    text: string;
}
```

There is no existing `out/dist/manifest.json` in this checkout at the time of this audit, so the contract above comes
from configuration and consumers rather than a generated artifact.

## 2. Introduce Vite Beside Webpack

Add `vite.config.ts` and a new script such as:

```bash
npm run vite
```

Initially, Vite should build the same frontend entrypoints without changing server rendering. Webpack remains the
production path.

### Current Findings

Vite has been added in parallel with Webpack:

```text
vite.config.ts
```

The new package script is:

```bash
npm run vite
```

The root dev dependency is:

```json
"vite": "^8.1.5"
```

The Vite build intentionally writes to a separate output directory:

```text
out/vite/static/
```

This avoids disturbing the current Webpack production output under:

```text
out/webpack/static/
```

The initial Vite config keeps the same source entrypoints:

```text
main     -> static/main.ts
noscript -> static/noscript.ts
```

It also includes temporary compatibility for current Webpack-era assumptions:

- `window.PRODUCTION` is defined for client code.
- bare `monaco-editor` resolves to Monaco's ESM editor API while Monaco subpath imports are left alone.
- `path` resolves to `path-browserify`.
- Webpack-style SCSS imports starting with `~` resolve through `node_modules`.
- GoldenLayout theme CSS imported from SCSS is inlined before Sass runs.
- client-side `.pug` imports keep the existing `{hash, text}` module shape.

The side-by-side Vite build now completes with:

```bash
npm run vite
```

Known differences from the current Webpack production contract:

- Vite writes its native manifest to `out/vite/static/.vite/manifest.json`, not `out/dist/manifest.json`.
- Vite manifest keys and values do not match the plain logical keys consumed by Pug, such as `main.js` and `vendor.css`.
- Vite outputs `rolldown-runtime.*.js` instead of Webpack's logical `runtime.js`.
- Vite currently emits assets under `assets/`.
- Vite 8 requires an ES2015-or-newer build target; it cannot emit ES5 directly.
- The production server still does not consume Vite output.

The package script now runs a post-build adapter:

```bash
npm-run-all vite:build vite:manifest
```

`etc/scripts/vite-manifest-adapter.ts` reads Vite's native manifest and writes a CE-style manifest to:

```text
out/vite/dist/manifest.json
```

The adapted manifest includes:

```text
main.js
main.css
noscript.js
noscript.css
runtime.js
vendor.js
vendor.css
```

It also includes files copied from `public/`, with identity mappings such as `favicon.ico -> favicon.ico`, so production
branding validation can use the same presence check once the server is pointed at Vite output.

This means Step 2 proves Vite can build the current frontend entrypoints beside Webpack and produce a CE-compatible
manifest beside the Vite output. The production server still does not consume Vite output.

## 3. Handle Entry Points

Port Webpack entries roughly as:

```text
static/main.ts      -> main bundle
static/noscript.ts  -> noscript bundle
SCSS/CSS imports    -> Vite CSS output
static assets       -> Vite asset pipeline
```

The goal is to get Vite producing usable JavaScript and CSS files before touching runtime behaviour.

## 4. Preserve Manifest Compatibility

Vite's default manifest shape differs from Webpack's current `out/dist/manifest.json`.

Either:

- configure or transform Vite's manifest into the existing Compiler Explorer format
- update `lib/app/rendering.ts` to support both manifest formats temporarily

Temporary dual support is preferable while Webpack and Vite coexist during migration.

## 5. Remove Client-Side Pug Imports

Per `PUG.md` and `docs/internal/VitePugMigration.md`, the blocking piece is the client imports from
`static/generated/*.pug`.

Move those documents into server-provided bootstrap/config data, or expose them via lightweight endpoints, then replace
imports like:

```ts
import privacyDocument from './generated/privacy.pug';
```

with data supplied by the backend.

## 6. Port Webpack-Specific Plugins and Loaders

Work through `webpack.config.esm.ts` and replace only what Vite actually needs:

- TypeScript transpilation
- SCSS handling
- asset copying
- Monaco configuration
- defines and environment variables
- legacy browser targets if required
- custom loaders, especially Pug

## 7. Wire Development Mode

Replace or parallel `webpack-dev-middleware` with Vite middleware in the dev server path. This should preserve Pug
rendering, but asset resolution should point at Vite dev URLs or modules.

### Initial Vite Dev Middleware Module

Vite-specific helpers have been added to `lib/app/static-assets.ts` alongside the existing Webpack helpers.

It currently provides:

```ts
setupViteDevMiddleware(options, router)
createViteDevPugRequireHandler(httpRoot)
```

The middleware uses Vite in `middlewareMode` with `appType: 'custom'`, so Express can continue to own the main request
routing and server-rendered Pug pages.

The first development asset mapping is:

```text
main.js     -> static/main.ts
noscript.js -> static/noscript.ts
```

This is intentionally not wired into `setupWebServer` yet. The remaining mismatch is that Vite dev entrypoints are ES
modules, while the current Pug templates emit classic script tags:

```pug
script(src=require("main.js"))
```

The next dev-mode step should make Pug script rendering aware of the active frontend bundler, or provide a Vite-specific
template block that emits:

```pug
script(type="module" src=...)
```

The CSS keys (`main.css`, `vendor.css`, `noscript.css`) also need a Vite-dev decision. In Vite development, CSS can be
loaded through the module graph instead of separate Pug stylesheet links.

## 8. Switch Production Build

Once Vite produces the right assets and manifest, add a production script such as:

```bash
npm run vite-build
```

Change `npm run webpack` only at the end, or add a separate script first so CI and local workflows can compare outputs.

## 9. Verify Incrementally

At each step:

- `npm run ts-check`
- relevant frontend tests
- local smoke test with `make dev` or the new Vite dev path
- rendered HTML asset URLs
- modals that previously depended on client-side Pug
- Monaco/editor loading

The first concrete step is to audit `webpack.config.esm.ts`, `lib/app/rendering.ts`, server dev middleware setup, and the
current `static/generated/*.pug` imports. Then add Vite in parallel without deleting Webpack.
