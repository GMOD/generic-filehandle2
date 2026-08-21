# generic-filehandle2

`docs/` carries the reasoning the code only gestures at: [api.md](docs/api.md),
[optimizations.md](docs/optimizations.md), [local-files.md](docs/local-files.md)
(the descriptor policy — held, retried on staleness, released on an idle timer),
and [browser-builds.md](docs/browser-builds.md). Read the relevant one before
proposing a change to the read path; several of the obvious simplifications
there are ruled out by a measurement.

## Package exports

The `browser` export condition in `package.json` is intentional and
load-bearing: it points at a build that stubs out `LocalFile`, the only class
importing `fs/promises`. Do not remove it or flatten it away — without it any
Vite browser build fails with
`"open" is not exported by "__vite-browser-external"`, and nothing in
`pnpm test` will notice, only `pnpm test:pack`.
[docs/browser-builds.md](docs/browser-builds.md) has the details, including why
jbrowse-desktop bypasses the whole mechanism.
