# Browser builds

`LocalFile` imports `fs/promises`, and nothing else in the package imports
anything specific to node. That single import is the reason the package ships a
`browser` export condition, and the reason removing it breaks every consumer
building with Vite:

```
"open" is not exported by "__vite-browser-external"
```

Vite, webpack and Rollup all resolve the `browser` condition when they build for
the browser, and it points at `esm/browser.js` or `dist/browser.js`, which is
the same entry point with the real `LocalFile` left out and a stub that rejects
every call put in its place.

```json
"exports": {
  "browser": { "import": "./esm/browser.js", "require": "./dist/browser.js" },
  "import": "./esm/index.js",
  "require": "./dist/index.js"
}
```

The order of those keys matters. `browser` comes first so that a bundler which
supports the condition takes it, while node, which does not implement that
condition at all, falls through to `import` or `require` and gets the real
class.

## The stub carries the same signatures as the real class

The stub is not `undefined`, and it is not a class whose methods take `any`.
Every member has the full signature of the real one, including both `readFile`
overloads, and the class declares `implements GenericFilehandle` so that
drifting away from the interface is a compile error here rather than a surprise
inside somebody else's bundle.

That is the whole reason it exists. Code written against `LocalFile` — a JBrowse
adapter that picks a filehandle based on the URI scheme, for example — still has
to typecheck in a bundle that resolves the `browser` condition, even though
actually calling it would fail at runtime. The constructor takes its parameters
and ignores them for the same reason. A bundle finds out that local files are
unavailable at the moment it tries to read one, through an error that names the
path it was given (`LocalFile is unimplemented in the browser (/path/to/file)`),
rather than at compile time or when the module is first imported.

JBrowse Desktop sidesteps all of this with a hardcoded webpack alias to
`dist/index.js`, so its renderer always gets the node build, which is what it
wants. That environment is also the reason `LocalFile` guards its call to
`unref`, which
[local-files.md](local-files.md#unref-is-not-available-everywhere) explains.

## Why the test suite cannot catch a broken export map

`pnpm test` runs against `src/`, so it never sees the `exports` field in
`package.json`, the build outputs, or the condition a bundler would resolve. A
missing build output or a flattened export map would ship without a single test
failing.

`scripts/test-pack.sh`, run as `pnpm test:pack` and required by `preversion`,
closes that gap by packing the real tarball, installing it into a scratch
directory, and importing it three ways: as ESM, as CJS, and under
`--conditions=browser`. The last of those checks that `LocalFile` is still
exported as a constructor and that calling it rejects. It is the only thing in
the repository that exercises the browser condition, and the only guard against
a failure that would otherwise show up in a consumer's build rather than here.

Anything new that imports `fs`, `path`, `os` or similar has to live behind the
same split, real in `index.ts` and stubbed in `browser.ts`, or not exist at all.
A node import that is reachable from `browser.ts` breaks every consumer using a
bundler, and `pnpm test:pack` is the only thing that will tell you.
