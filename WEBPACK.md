# Webpack in Compiler Explorer

This note explains how Webpack fits into the Compiler Explorer frontend and server startup flow.

## Short Version

Webpack bundles the browser-side application only.

It does not bundle the backend application at production runtime. The backend either consumes files that Webpack already
produced, or, in development mode, hosts Webpack dev middleware so frontend assets can be generated in memory.

```text
static/main.ts
static/noscript.ts
SCSS
Pug-loaded client templates
fonts/images/assets
        |
        v
webpack.config.esm.ts
        |
        v
out/webpack/static/*.js
out/webpack/static/*.css
out/dist/manifest.json
```

## Initial Browser Request

When a browser opens `compiler-explorer.com`, the first response is a server-rendered HTML shell. The server renders Pug
templates such as:

- `views/index.pug`
- `views/_layout.pug`

That HTML contains the navbar, menus, modal templates, `#root`, and a `#config` element containing server-generated
client options.

The browser then loads Webpack output:

```pug
script(src=require("runtime.js"))
script(src=require("vendor.js"))
script(src=require("main.js"))
```

`main.js` is built from `static/main.ts`. It starts the interactive client application: reads config, fetches language
and compiler metadata, creates the GoldenLayout workspace, and initialises panes such as editors and compiler outputs.

## Production Mode

In production, Webpack has already run before the server handles traffic.

```text
npm run webpack
```

The build writes browser assets to:

```text
out/webpack/static/
```

It also writes a manifest to:

```text
out/dist/manifest.json
```

The manifest maps logical asset names to the actual built files, for example:

```json
{
    "main.js": "main.b711175059b980b20eb2.js",
    "vendor.js": "vendor.94bb3e70085656309746.js",
    "main.css": "main.3d9fed233d4451733696.css"
}
```

At production runtime, the backend does not produce these JavaScript files. It reads the existing manifest and uses it
when rendering Pug, so:

```pug
script(src=require("main.js"))
```

becomes a URL for the hashed asset, often from the static CDN:

```html
<script src="https://static.ce-cdn.net/main.b711175059b980b20eb2.js"></script>
```

If no external `staticUrl` is configured, Express serves the already-built files from `out/webpack/static`.

## Development Mode

In development mode, the backend starts `webpack-dev-middleware`.

The server imports the Webpack config, creates a Webpack compiler, and attaches middleware to the Express router. The
frontend bundles are then produced in memory and served by the running development server.

In this mode, Pug asset references resolve to simple paths such as:

```text
/main.js
/vendor.js
/runtime.js
```

The files do not need to exist on disk in `out/webpack/static` for the dev server to serve them.

## Request Flow Summary

```text
Browser requests /
    -> Express renders Pug HTML
    -> HTML contains #root and #config
    -> HTML references runtime.js, vendor.js, main.js
    -> Browser downloads Webpack-built assets
    -> static/main.ts code runs from main.js
    -> Client creates GoldenLayout and panes
    -> Compile actions become API requests to the backend
```

Compilation itself does not happen in the browser. The client sends source code, compiler ID, options, filters, and
library selections to backend API endpoints; the backend performs or dispatches the compilation and returns structured
results for the client to render.
