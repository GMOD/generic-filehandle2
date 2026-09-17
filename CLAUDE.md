# generic-filehandle2

The `docs/` folder carries the reasoning that the code itself only gestures at.
[api.md](docs/api.md) documents the interface,
[optimizations.md](docs/optimizations.md) explains why the read path looks the
way it does, and [local-files.md](docs/local-files.md) covers how `LocalFile`
manages its file descriptor and how it is stubbed out in browser builds. Read
whichever is relevant before proposing a change to the read path, because
several of the obvious simplifications there are ruled out by a measurement.

## Package exports

The `browser` export condition in `package.json` is intentional and required. It
points to `esm/browser.js` / `dist/browser.js`, which stubs out `LocalFile` (the
only class that imports from Node.js `fs/promises`). Vite, webpack, and Rollup
use this condition when building for the browser.

Do not remove it or flatten it away — without it, any Vite browser build will
fail with:

```
"open" is not exported by "__vite-browser-external"
```

The jbrowse-desktop Electron app bypasses this entirely via a hardcoded webpack
alias to `dist/index.js`, so it always gets the full Node.js build regardless of
export conditions.
