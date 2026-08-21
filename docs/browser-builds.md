# Browser builds

`LocalFile` imports `fs/promises`. Nothing else in the package imports anything
node-specific. That one import is why the package ships a `browser` export
condition, and why removing it breaks every Vite consumer with:

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

Order matters: `browser` is first, so a bundler that supports the condition
takes it, and node — which does not implement it — falls through to
`import`/`require` and gets the real class.

## The stub has the real signatures

The stub is not `undefined`, and not a class taking `any`. Every member carries
the full signature of the real one, `readFile` overloads included, and it
declares `implements GenericFilehandle` so drift from the interface is a compile
error rather than a runtime surprise in somebody else's bundle.

That is the one thing it exists to do. Code written against `LocalFile` — a
JBrowse adapter picking a filehandle by URI scheme, say — has to **typecheck**
in a bundle resolving the `browser` condition, even though the call would fail
at runtime. Constructor parameters are accepted and unread for the same reason:
a bundle discovers that local files are unavailable when it tries to read one,
with an error naming the path
(`LocalFile is unimplemented in the browser (/path/to/file)`), not at compile or
import time.

JBrowse Desktop bypasses all of this with a hardcoded webpack alias to
`dist/index.js`, so its renderer always gets the node build — which is what it
wants, and also the reason for the `unref` guard in `LocalFile`
([local-files.md](local-files.md#unref-is-not-always-there)).

## Why the test suite cannot catch a broken export map

`pnpm test` runs against `src/`. It never sees `package.json`'s exports, the
build outputs, or the condition a bundler would resolve, so a missing build
output or a flattened export map ships green.

`scripts/test-pack.sh` (`pnpm test:pack`, gated on in `preversion`) closes that
hole by packing the real tarball, installing it into a scratch directory, and
importing it as ESM, as CJS, and under `--conditions=browser` — the last
asserting that `LocalFile` is present as a constructor and that calling it
rejects. That third arm is the one nothing else exercises, and the one whose
failure lands in a consumer's build rather than here.

Anything new importing `fs`, `path`, `os` or similar must live behind the same
split — real in `index.ts`, stubbed in `browser.ts` — or not exist. A node
import reachable from `browser.ts` breaks every bundler consumer, and only
`pnpm test:pack` will tell you.
