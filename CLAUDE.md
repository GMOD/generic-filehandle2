# generic-filehandle2

The `docs/` folder carries the reasoning that the code itself only gestures at.
[api.md](docs/api.md) documents the interface,
[optimizations.md](docs/optimizations.md) explains why the read path looks the
way it does, [local-files.md](docs/local-files.md) covers how `LocalFile`
manages its file descriptor, and [browser-builds.md](docs/browser-builds.md)
covers the browser export condition. Read whichever one is relevant before
proposing a change to the read path, because several of the obvious
simplifications there are ruled out by a measurement.

## Package exports

The `browser` export condition in `package.json` is intentional and
load-bearing: it points at a build that stubs out `LocalFile`, the only class
importing `fs/promises`. Do not remove it or flatten it away — without it any
Vite browser build fails with
`"open" is not exported by "__vite-browser-external"`, and nothing in
`pnpm test` will notice, only `pnpm test:pack`.
[docs/browser-builds.md](docs/browser-builds.md) has the details, including why
jbrowse-desktop bypasses the whole mechanism.
