## [2.2.2](https://github.com/GMOD/generic-filehandle2/compare/v2.2.1...v2.2.2) (2026-08-06)

### Bug Fixes

- Correct RemoteFile request building, buffer retention, and stat caching

### Chores

- Share one eslint-plugin-unicorn opt-out list across the repos
- Turn off unicorn/prefer-early-return across the repos
- Replace standard-changelog with git-cliff for changelog generation
- Drop eslint-plugin-unicorn
- Type-check the tests and enforce prettier, as @gmod/bam does

### Documentation

- Backfill CHANGELOG.md from git history
- Mark breaking changes in the generated changelog

# Changelog

This changelog was backfilled from git history in 2026-08; entries for
older versions are reconstructed from diffs rather than contemporaneous
notes, since many commit messages at the time didn't capture the
user-facing change.

## v2.2.1 (2026-07-25)

- Pin `packageManager` to `pnpm@11.15.1` and add `sideEffects: false` for better tree-shaking by bundlers.
- Ban TypeScript parameter properties via a new lint rule, keeping output type-strippable by tools like esbuild.
- CI: pin all GitHub Actions to commit SHA, derive pnpm version from `packageManager`, move to Node 24.
- Set pnpm `minimumReleaseAge` to 3 days to avoid installing just-published dependency versions.

## v2.2.0 (2026-06-17)

- Add opt-in download-progress reporting: `onProgress?: (bytesReceived: number, total?: number) => void` on `FilehandleOptions`, used by `RemoteFile.read`/`readFile`.
- Stream the response body into a pre-sized buffer (from Content-Length) and tick the callback (throttled to 50ms) as chunks arrive; falls back to a one-shot read when length is unknown.
- Export the `ProgressCallback` type from the package index.

## v2.1.10 (2026-05-27)

- Fix `RemoteFile.read` to translate HTTP 416 (Range Not Satisfiable) into an empty `Uint8Array` return instead of throwing, so callers can detect EOF via a short/empty read.

## v2.1.9 (2026-05-18)

- Internal: rename the merged CI workflow file back to `publish.yml` so npm OIDC trusted publishing recognizes it.

## v2.1.8 (2026-05-18)

- Refactor `RemoteFile`: extract a `buildRequest()` helper that merges base/overrides/per-call headers, removing duplication between `read()` and `readFile()`.
- Extract shared `toBytes()` into `src/util.ts`, used by `RemoteFile` and `BlobFile`.
- Dedupe the `readFile` TypeScript overloads across `GenericFilehandle`, `LocalFile`, `RemoteFile`, and `BlobFile`.
- `RemoteFile.read` now records `_stat.size` from the response body when the server ignores the range request and returns a full 200.
- Fix `BlobFile.read`'s zero-length check (`length === 0` instead of `!length`) to avoid treating `NaN` as zero-length.
- CI: merge the publish workflow into the push workflow, gated on the test job.

## v2.1.7 (2026-05-01)

- Document why the `browser` export condition must not be removed (moved from README into CLAUDE.md). No functional change.

## v2.1.6 (2026-05-01)

- Fix: restore the `browser` export condition in package.json, accidentally dropped by the v2.1.5 package.json cleanup. This had broken Vite browser builds with `"open" is not exported by "__vite-browser-external"`.

## v2.1.5 (2026-04-27)

- Fix `stat()` to degrade gracefully instead of throwing when Content-Range can't be read (e.g. blocked by CORS): returns `{ size: 0 }` instead.
- Replace `eslint-plugin-import` with `eslint-plugin-import-x`; enable `noUncheckedIndexedAccess` in tsconfig.
- Simplify package.json/tsconfig/build scripts; remove unused dependencies. This inadvertently dropped the `browser` export condition, fixed next release.
- Rewrite README to be more concise; document npm trusted-publishing setup.

## v2.1.4 (2026-03-27)

- CI: use Node 24 for the publish workflow (npm 11 is required for OIDC trusted publishing).

## v2.1.3 (2026-03-27)

- Fix trusted publishing by no longer injecting `GITHUB_TOKEN` as `NODE_AUTH_TOKEN` in the publish workflow.
- Add CONTRIBUTING.md documenting the dev workflow and npm trusted-publishing steps.

## v2.1.2 (2026-03-27)

- Fix npm trusted publishing and the package.json `repository` field (needed the object form for provenance validation).

## v2.1.1 (2026-03-27)

- Add a GitHub Actions `publish.yml` workflow for trusted (OIDC) npm publishing on version tags.

## v2.1.0 (2026-03-27)

- Migrate build tooling from yarn to pnpm; update CI to Node 22.
- Upgrade TypeScript to v6, switch `moduleResolution` to `nodenext`, enable `skipLibCheck: false`.
- Define `BufferEncoding` locally instead of relying on `@types/node`, so consumers no longer need it as a dependency.
- **Breaking:** `RemoteFile` now accepts headers via `opts.headers` directly (merged as `baseHeaders`), separate from `opts.overrides` — previously auth headers had to go through `overrides.headers`.
- Replace remaining `any` types with concrete types; remove the `Stats` index-signature escape hatch.
- Add a `TypeError` guard in `RemoteFile.read()` for `NaN` length/position.
- **Breaking:** `LocalFile` constructor no longer accepts an unused `opts` parameter.
- Strengthen ESLint config: `consistent-type-imports`, `no-explicit-any`, `eqeqeq`, `import/extensions`.

## v2.0.18 (2025-12-28)

- Fix `GenericFilehandle.readFile`'s conditional overload return type, which had the encoding/Uint8Array branches backwards.
- `RemoteFile.readFile` now checks `!res.ok` instead of `res.status !== 200`, correctly accepting other 2xx statuses.
- Consolidate duplicated error-wrapping in `RemoteFile.fetch` into a `wrapError` helper.

## v2.0.17 (2025-12-28)

- Fix `LocalFile.read()` to swallow errors from closing the file descriptor in its `finally` block (e.g. EBADF on network filesystems like Samba), instead of letting a close failure mask the real read result.

## v2.0.16 (2025-12-11)

- `LocalFile.read(0, ...)` and `RemoteFile.read(0, ...)` now return an empty `Uint8Array` immediately instead of issuing a real read/range request, avoiding a degenerate-range edge case.

## v2.0.15 (2025-12-11)

- Fix an off-by-one bug in `RemoteFile.read`'s Range header: it requested one extra byte (`position + length` instead of `position + length - 1`).
- Fix header precedence in `RemoteFile`: per-call `headers`/`overrides.headers` now correctly take priority over the constructor's `baseOverrides.headers`.
- Use `Response.bytes()`/`Blob.bytes()` when available, falling back to `arrayBuffer()`.
- `BlobFile` no longer caches `blob.size` at construction; `stat()` reads it live, fixing stale sizes if the blob is reused.

## v2.0.14 (2025-09-10)

- No functional change — dependency lockfile refresh only.

## v2.0.13 (2025-09-08)

- Fix potential EBADF errors: `LocalFile.read()` now closes the file descriptor in a `finally` block so it's always closed even if the read throws.

## v2.0.12 (2025-06-10)

- Add a browser-specific bundle (`src/browser.ts`) that excludes `LocalFile`'s Node-only `fs/promises` import, exporting a stub that throws `unimplemented`.
- Wire it up via the package.json `browser` export condition — the origin of the condition documented as load-bearing in this repo's CLAUDE.md.

## v2.0.11 (2025-06-10)

- Switch to the `browser` export condition instead of the `browser` field's `false`-mapping trick, to more reliably exclude `LocalFile` from browser bundles.

## v2.0.10 (2025-06-07)

- No functional change — package.json `exports` field reformatted back to the nested `import`/`require` object form.

## v2.0.9 (2025-06-07)

- Revert the "Pure ESM" experiment from v2.0.8: restore dual `module`/`main` fields instead of a single ESM-only `exports` field.

## v2.0.8 (2025-06-07)

- Attempt a "Pure ESM" package.json shape (single `exports` string plus `main`/`module` fields); drop the `node-fetch` devDependency. Reverted the next release.

## v2.0.7 (2025-05-26)

- Revert the browser-exclusion mechanism added two releases prior: remove `src/mockLocalFile.ts` and its `browser` package.json mappings.

## v2.0.6 (2025-05-25)

- Second attempt at the package.json export shape: restore `type: module` with nested `exports.import`/`exports.require`, and restore `browser` field mappings for `fs`/`fs/promises` to `false`.

## v2.0.5 (2025-05-25)

- Revert the download-progress feature added in v2.0.4: remove `statusCallback`, `getProgressDisplayStr`/`toLocale`, and the streaming-read logic from `RemoteFile.readFile`.
- Revert package.json back to the non-ESM shape; restore the `node-fetch` devDependency.

## v2.0.4 (2025-05-25)

- Add opt-in download-progress reporting: `statusCallback?: (arg: string) => void` on `FilehandleOptions`; `RemoteFile.readFile()` streams the response and reports "Downloading X/Y Mb" as chunks arrive. Reverted the next release.
- Switch package.json to `type: module` with a single-entry `exports` shape.
- Add `src/mockLocalFile.ts`, a stub `LocalFile` for browser builds via the package.json `browser` field — an early attempt at browser/Node splitting, later replaced by `src/browser.ts` in v2.0.12.

## v2.0.3 (2025-05-13)

- Revert package.json to the simple `main`/`module` dual-field shape, dropping the `type: module` + nested `exports` introduced in v2.0.0 — the first of several rounds of back-and-forth over the correct ESM/CJS shape that continues through v2.0.12.

## v2.0.2 (2025-05-13)

- Add a `postbuild:es5` script that writes `dist/package.json` with `{"type": "commonjs"}`, so the CJS build directory is correctly marked despite the package root being `type: module`.
- Fix the Build Status badge branch reference from `master` to `main`.

## v2.0.1 (2025-04-30)

- No behavioral change — `src/index.ts` re-export paths updated to explicit `.ts` extensions, consistent with the new TS config from v2.0.0.

## v2.0.0 (2025-04-30)

- **Breaking:** add a pure-ESM build alongside CJS. package.json gains `type: "module"`, `types`, and a structured `exports` map; tsconfig enables source imports with explicit `.ts` extensions that get rewritten per output format.
- Convert type-only imports to `import type` throughout.
- Add `eslint-plugin-import` with enforced import ordering.

## v1.0.0 (2024-12-12)

- Remove the unused `src/declare.d.ts` ambient module declaration.
- Simplify `LocalFile.read()`'s constructor/method signatures.
- First stable release; no behavioral changes from v0.0.2, mostly signature/type cleanup.

## v0.0.2 (2024-12-12)

- Fix a read-correctness bug in `RemoteFile`: `read()` now slices the fetched buffer to the requested `length` before returning, instead of returning the full fetched buffer, which could over-read when the server returned more data than requested.
- Export the `GenericFilehandle` type from `src/index.ts` (previously only the concrete classes were exported).
- Remove the unused Babel-based `watch` script.

## v0.0.1 (2024-12-11)

- Initial release. Provides `LocalFile`, `RemoteFile`, and `BlobFile` classes implementing a uniform `GenericFilehandle` interface (`read`, `readFile`, `stat`, `close`) for accessing binary data from local files, remote HTTP resources, and browser `Blob` objects — a modernized, Buffer-free alternative to the original `generic-filehandle` package.
