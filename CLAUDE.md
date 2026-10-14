# generic-filehandle2

The `docs/` folder records the reasoning behind the code. [api.md](docs/api.md)
documents the interface, [optimizations.md](docs/optimizations.md) explains the
design of the read path, and [local-files.md](docs/local-files.md) covers how
`LocalFile` manages its file descriptor and how browser builds replace it with a
stub. Read whichever is relevant before proposing a change to the read path,
because measurements rule out several of the obvious simplifications there.

## Package exports

The `browser` export condition in `package.json` is intentional and required. It
points to `esm/browser.js` / `dist/browser.js`, which stubs out `LocalFile` (the
only class that imports from Node.js `fs/promises`). Vite, webpack, and Rollup
use this condition when building for the browser.

Keep the condition; don't remove it or flatten it away. Without it, any Vite
browser build fails with:

```
"open" is not exported by "__vite-browser-external"
```

The jbrowse-desktop Electron app bypasses the export conditions with a hardcoded
webpack alias to `dist/index.js`, so it always gets the full Node.js build.
