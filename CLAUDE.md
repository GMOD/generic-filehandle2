# generic-filehandle2

## Package exports

The `browser` export condition in `package.json` is intentional and load-bearing. It points to `esm/browser.js` / `dist/browser.js`, which stubs out `LocalFile` (the only class that imports from Node.js `fs/promises`). Vite, webpack, and Rollup use this condition when building for the browser.

Do not remove it or flatten it away — without it, any Vite browser build will fail with:

```
"open" is not exported by "__vite-browser-external"
```

The jbrowse-desktop Electron app bypasses this entirely via a hardcoded webpack alias to `dist/index.js`, so it always gets the full Node.js build regardless of export conditions.
