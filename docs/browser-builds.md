# Browser builds

`LocalFile` imports `fs/promises`. Nothing else in the package imports anything
node-specific. That one import is why the package ships a `browser` export
condition, and why removing it breaks every Vite consumer:

```
"open" is not exported by "__vite-browser-external"
```

Vite, webpack and Rollup all resolve `browser` when building for the browser,
and it points at `esm/browser.js` / `dist/browser.js` — the same entry point
minus the real `LocalFile`, plus a stub that rejects every call.

```json
"exports": {
  "browser": { "import": "./esm/browser.js", "require": "./dist/browser.js" },
  "import": "./esm/index.js",
  "require": "./dist/index.js"
}
```

Condition order is significant: `browser` is listed first, so a bundler that
supports it takes it, and node — which does not implement the condition — falls
through to `import`/`require` and gets the real class.

## The stub has the real signatures

The stub is not `export const LocalFile = undefined`, and not a class with
`(...args: any[])` constructors. Every member carries the full signature of the
real one, `readFile` overloads included, and the class declares
`implements GenericFilehandle`.

That is the one thing it exists to do. Code written against `LocalFile` — a
JBrowse adapter, say, that picks a filehandle by URI scheme — has to
**typecheck** in a bundle resolving the `browser` condition, even though the
call would fail at runtime. Constructor parameters are accepted and unread for
the same reason: a bundle discovers that local files are unavailable at the
point it tries to read one, with an error naming the path
(`LocalFile is unimplemented in the browser (/path/to/file)`), not at compile
time and not at import time.

`implements GenericFilehandle` makes drift between the stub and the interface a
compile error rather than a runtime surprise in somebody else's bundle.

## Electron

JBrowse Desktop bypasses the whole mechanism with a hardcoded webpack alias to
`dist/index.js`, so it always gets the node build regardless of conditions —
which is what it wants, since its renderer can read local files.

That environment is the reason for the `unref` guard in `LocalFile`: node's `fs`
is real there, but `setTimeout` is the DOM's and returns a number.
[local-files.md](local-files.md#unref-is-not-always-there) has the failure and
its symptom.

## Why the test suite cannot catch a broken export map

`pnpm test` runs against `src/`. It never sees `package.json`'s exports, the
build outputs, or the condition a bundler would resolve — so a missing build
output or a flattened export map ships green.

`scripts/test-pack.sh` (run as `pnpm test:pack`, and gated on in `preversion`)
closes that hole by packing the real tarball, installing it into a scratch
directory, and importing it three ways:

- **ESM** — `import` from the package
- **CJS** — `require` of the same
- **the `browser` condition** — resolved explicitly, then asserting that
  `LocalFile` is present as a constructor and that calling it rejects

The third is the one nothing else in the repo exercises, and the one whose
failure mode is a consumer's build rather than anything visible here.

## If you are adding a node dependency

Anything importing from `fs`, `path`, `os` or similar must either live behind
the same split — real in `index.ts`, stubbed in `browser.ts` — or not exist. A
node import reachable from `browser.ts` breaks every bundler consumer, and the
only thing that will tell you is `pnpm test:pack`.
