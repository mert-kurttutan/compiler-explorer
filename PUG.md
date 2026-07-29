# Pug in Compiler Explorer

Compiler Explorer uses Pug in two distinct ways:

- server-rendered Pug templates under `views/`
- Webpack-loaded Pug fragments imported by client TypeScript under `static/generated/`

These paths serve different purposes.

## Server-Rendered Pug

The initial browser request is handled by Express. For the normal homepage, the backend renders:

```text
views/index.pug
    extends views/_layout.pug
```

The route is configured in `lib/app/server-config.ts`:

```ts
res.render('index', renderConfig(...));
```

This produces the first HTML document returned to the browser. That document contains:

- the navbar and top-level menus
- modal and popup templates
- the `#root` element where the client app will create the GoldenLayout workspace
- the `#config` element containing encoded server-provided client options
- links to Webpack-built CSS and JavaScript assets

The page shell is server-rendered, but the interactive application starts later when the browser loads `main.js`.

## Pug Asset References

Server-rendered Pug templates refer to Webpack output with a template-level `require` helper:

```pug
link(href=require("vendor.css") rel="stylesheet")
link(href=require("main.css") rel="stylesheet")

script(src=require("runtime.js"))
script(src=require("vendor.js"))
script(src=require("main.js"))
```

This is not Node's module `require`. It is a custom function injected into the render options by
`lib/app/rendering.ts`:

```ts
options.require = pugRequireHandler;
```

The backend creates `pugRequireHandler` during web server setup.

## Production Integration

In production, Webpack has already built the frontend assets and written a manifest:

```text
out/dist/manifest.json
```

The manifest maps logical asset names to hashed filenames:

```json
{
    "main.js": "main.b711175059b980b20eb2.js",
    "vendor.js": "vendor.94bb3e70085656309746.js",
    "main.css": "main.3d9fed233d4451733696.css"
}
```

When Pug renders:

```pug
script(src=require("main.js"))
```

the custom `require` handler resolves it through the manifest, producing a URL for the actual hashed asset, for example:

```html
<script src="https://static.ce-cdn.net/main.b711175059b980b20eb2.js"></script>
```

So in production:

```text
Webpack builds assets
    -> Webpack writes manifest
    -> backend reads manifest
    -> Pug calls require("main.js")
    -> rendered HTML points at hashed asset URL
```

## Development Integration

In development mode, the backend starts `webpack-dev-middleware`.

The dev middleware runs Webpack inside the server process and serves generated frontend assets from memory. Pug still
uses the same logical references:

```pug
script(src=require("main.js"))
```

but the custom `require` handler resolves them to simple development paths such as:

```text
/main.js
/vendor.js
/runtime.js
```

The frontend bundles do not need to exist on disk for the development server to serve them.

## Webpack-Loaded Pug Fragments

Some Pug files are imported directly by client TypeScript:

```ts
import changelogDocument from './generated/changelog.pug';
import cookiesDocument from './generated/cookies.pug';
import privacyDocument from './generated/privacy.pug';
```

These imports are handled by the Webpack rule in `webpack.config.esm.ts`:

```ts
{
    test: /\.pug$/,
    loader: path.resolve(__dirname, 'etc/webpack/parsed-pug-loader.js'),
}
```

The custom loader compiles the Pug file into HTML text and returns a JavaScript module:

```ts
{
    hash: string;
    text: string;
}
```

The type is declared in `static/client.d.ts`.

These fragments are used by the browser-side code for modal/popup content such as the changelog, cookies policy, and
privacy policy.

## Mental Model

```text
views/*.pug
    rendered by Express on the backend
    produces the initial HTML page
    uses require("main.js") to resolve Webpack asset URLs

static/generated/*.pug
    imported by client TypeScript
    compiled by Webpack using parsed-pug-loader
    becomes an object with { hash, text }
```

Pug's main job is to produce HTML. In `views/`, it produces complete server-rendered pages. In `static/generated/`, it
produces small HTML strings that Webpack embeds into the client bundle.
