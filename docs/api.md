# API

Three classes implement one interface, `GenericFilehandle`:

| class        | source          | where it runs                         |
| ------------ | --------------- | ------------------------------------- |
| `LocalFile`  | a path on disk  | node only — stubbed in browser builds |
| `RemoteFile` | an HTTP(S) URL  | anywhere `fetch` exists               |
| `BlobFile`   | a `Blob`/`File` | anywhere `Blob` exists                |

```ts
interface GenericFilehandle {
  read(
    length: number,
    position: number,
    opts?: FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile(options?: ReadFileOptions): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: ReadFileTextOptions): Promise<string>
  stat(): Promise<Stats>
  close(): Promise<void>
}
```

A consumer should accept the interface, not a class. That is the whole point of
the package: `@gmod/bam`, `@gmod/tabix`, `@gmod/bbi` and the rest take a
`GenericFilehandle` and never learn whether the bytes came from a disk, a
server, or a file the user dragged into a browser tab.

## `read(length, position, opts?)`

Returns the bytes at that byte offset, as a `Uint8Array<ArrayBuffer>`. The
generic parameter matters to callers that hand the buffer to wasm or to a
worker: it promises a plain `ArrayBuffer` rather than a `SharedArrayBuffer`, so
the result is transferable and `TextDecoder`-decodable.

Three edge behaviors every implementation shares:

- **A short read is not an error.** Reading past the end of the file returns
  fewer bytes than asked for, and reading entirely past it returns an empty
  array. This is how a caller detects EOF without a separate `stat()` — see
  [optimizations.md](optimizations.md#eof-without-a-size-oracle).
- **`length === 0` returns an empty array without touching the source.** For
  `BlobFile` that is not just an optimization; some browsers crash on a
  zero-byte read of a local file.
- **`RemoteFile` rejects a non-integer, negative, or `NaN` length or position**
  with a `TypeError` naming both values. A corrupt index produces `NaN` from
  ordinary arithmetic, and it would otherwise reach the server as a range header
  that can only be rejected, well away from the actual bug.

## `readFile(options?)`

The whole file. Returns `Uint8Array<ArrayBuffer>`, or a `string` when an
encoding is given. The overloads make that a compile-time distinction rather
than a `Uint8Array | string` union the caller has to narrow.

Both spellings of utf8 work everywhere: `'utf8'` and `'utf-8'`. `LocalFile`
passes the option straight to node's `readFile`, so it takes any encoding node
does; `RemoteFile` and `BlobFile` decode utf8 and throw
`unsupported encoding: <x>` for anything else.

Either a bare encoding string or an options object is accepted, in every
implementation:

```js
await file.readFile('utf8')
await file.readFile({ encoding: 'utf8', signal })
```

## `stat()`

`{ size: number }`.

`LocalFile` calls node's `stat`. `BlobFile` reads `blob.size`. `RemoteFile` has
no size oracle at all, so it learns the size as a side effect of reading —
covered in
[optimizations.md](optimizations.md#stat-costs-one-small-read-at-most). A server
that does not expose `Content-Range` through CORS yields `{ size: 0 }` rather
than throwing, so a caller that only wants to display a size degrades instead of
failing.

## `close()`

Releases what the handle holds, which is only ever a file descriptor, and only
for `LocalFile`. It is **a hint, not a teardown**: reading again reopens, and
calling it twice is fine. [local-files.md](local-files.md) covers the descriptor
lifecycle, including the idle timeout that closes it for you.

## Options

`FilehandleOptions`, accepted per call and (for `RemoteFile`) in the
constructor:

| option       | type                                      | applies to      |
| ------------ | ----------------------------------------- | --------------- |
| `signal`     | `AbortSignal`                             | all three       |
| `headers`    | `Record<string, string>`                  | `RemoteFile`    |
| `overrides`  | `Omit<RequestInit, 'headers'>`            | `RemoteFile`    |
| `encoding`   | `BufferEncoding`                          | `readFile` only |
| `fetch`      | `(input, init?) => Promise<Response>`     | `RemoteFile`    |
| `onProgress` | `(bytesReceived: number, total?) => void` | `RemoteFile`    |

### `signal`

`RemoteFile` passes it to `fetch`, which genuinely cancels an in-flight request.
**Neither node's `fs` nor a `Blob` read can be cancelled**, so `LocalFile` and
`BlobFile` check the signal on either side of the read: the read still runs to
completion, but the bytes do not reach a caller that has given up, and the
promise rejects like every other implementation's. Treating cancellation as
uniform at the API is the point; it is not a promise that the work stopped.

A `signal` given to the `RemoteFile` constructor applies to every call. A
per-call `signal` wins over the constructor's, which wins over one smuggled in
through `overrides`.

### `headers` and `overrides`

`headers` merge into every request. `overrides` are extra `fetch` parameters and
are applied **after** the defaults this library sets (`method: 'GET'`,
`redirect: 'follow'`, `mode: 'cors'`), so a caller can change any of them.

Range headers are the exception, and deliberately so: a caller's own `Range`
header is dropped for the one a ranged read builds, case-insensitively. See
[optimizations.md](optimizations.md#a-callers-range-header-cannot-double-up-with-ours)
for the multipart body that would otherwise come back.

### `fetch`

Any function with fetch's signature. Used for auth wrappers, request logging,
proxying, and tests. The default is `globalThis.fetch` bound to `globalThis`.

The `Response` it returns does not have to be the platform's — progress
reporting duck-types `body` rather than testing `instanceof Response`, so an
implementation from another realm or another library still streams.

### `onProgress`

Opt-in download progress for `RemoteFile`, called as `(bytesReceived, total?)`
while the body arrives. `total` comes from `Content-Length`.

Setting it switches the read to a streaming path; omitting it keeps the faster
one-shot read. Ticks are throttled to one per 50ms, and the final exact count is
always emitted. When the length is unknown the body cannot be streamed into a
pre-sized buffer, so there is nothing to report incrementally: it reads in one
shot and emits a single completion tick.

## Constructor options

```js
new LocalFile(path, { cacheFd, fdIdleTimeoutMs })
new RemoteFile(url, { fetch, headers, overrides, signal })
new BlobFile(blob)
```

`LocalFile`'s two options are the descriptor policy, both documented in
[local-files.md](local-files.md):

- `cacheFd` (default `true`) — hold one descriptor across reads
- `fdIdleTimeoutMs` (default `30000`) — release it after this long with no read;
  `0` holds it until `close()`

## Subclassing `RemoteFile`

Two seams, at two altitudes:

- `protected fetchBytes(length, position, opts)` — override to **serve bytes**
- `public fetch(input, init?)` — override to **change how requests are made**

Overriding neither leaves the ranged GET. [subclassing.md](subclassing.md) has
the reasoning and the measurement that made `fetchBytes` worth adding.

## Types

`BufferEncoding` is declared here rather than imported from `@types/node`, so
consuming code does not need node's types to typecheck a call to `readFile`.

`ReadFileOptions` is `FilehandleOptions` without `encoding` (the bytes
overload); `ReadFileTextOptions` is a bare encoding string or options carrying
one (the string overload).
