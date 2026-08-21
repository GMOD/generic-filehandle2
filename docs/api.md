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

Consumers should accept the interface, not a class — `@gmod/bam`, `@gmod/tabix`,
`@gmod/bbi` and the rest never learn whether the bytes came from a disk, a
server, or a file dragged into a browser tab.

## `read(length, position, opts?)`

Bytes at a byte offset, as `Uint8Array<ArrayBuffer>`. The generic parameter
promises a plain `ArrayBuffer` rather than a `SharedArrayBuffer`, so the result
is transferable to a worker and decodable by `TextDecoder`.

Three edge behaviors every implementation shares:

- **A short read is not an error.** Reading past the end returns fewer bytes,
  and reading entirely past it returns an empty array — which is how a caller
  detects EOF without a separate `stat()`
  ([why](optimizations.md#eof-without-a-size-oracle)).
- **`length === 0` returns empty without touching the source.** For `BlobFile`
  that is a correctness fix: some browsers crash on a zero-byte read.
- **`RemoteFile` rejects a non-integer, negative or `NaN` offset** with a
  `TypeError` naming both values. A corrupt index yields `NaN` from ordinary
  arithmetic, which would otherwise reach the server as an unanswerable range
  header, well away from the actual bug.

## `readFile(options?)`

The whole file: `Uint8Array<ArrayBuffer>`, or a `string` when an encoding is
given. The overloads make that a compile-time distinction rather than a union
the caller has to narrow.

Both spellings of utf8 work everywhere. `LocalFile` hands the option to node's
`readFile`, so it takes any encoding node does; `RemoteFile` and `BlobFile`
decode utf8 and throw `unsupported encoding: <x>` otherwise. Either a bare
encoding string or an options object is accepted:

```js
await file.readFile('utf8')
await file.readFile({ encoding: 'utf8', signal })
```

## `stat()`

`{ size: number }`. `LocalFile` calls node's `stat`, `BlobFile` reads
`blob.size`, and `RemoteFile` has no size oracle so it learns the size from
reading ([how](optimizations.md#stat-costs-one-small-read-at-most)). Where CORS
hides `Content-Range` it yields `{ size: 0 }` rather than throwing, so a caller
that only wants to display a size degrades instead of failing.

## `close()`

Releases what the handle holds, which is only ever `LocalFile`'s descriptor. It
is **a hint, not a teardown**: reading again reopens, and calling it twice is
fine. [local-files.md](local-files.md) covers the lifecycle, including the idle
timeout that closes it for you.

## Options

`FilehandleOptions`, accepted per call and (for `RemoteFile`) in the
constructor:

| option       | type                                      | notes                                                                      |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------- |
| `signal`     | `AbortSignal`                             | see below                                                                  |
| `headers`    | `Record<string, string>`                  | merged into every request; the library's range header wins over a caller's |
| `overrides`  | `Omit<RequestInit, 'headers'>`            | extra `fetch` params, applied over the `method`/`redirect`/`mode` defaults |
| `encoding`   | `BufferEncoding`                          | `readFile` only                                                            |
| `fetch`      | `(input, init?) => Promise<Response>`     | default `globalThis.fetch`; the `Response` need not be the platform's      |
| `onProgress` | `(bytesReceived: number, total?) => void` | opt-in; switches to a streaming read, ticks throttled to 50ms              |

Everything but `signal` and `encoding` is `RemoteFile`-only.

**`signal`.** `RemoteFile` passes it to `fetch`, which genuinely cancels the
request. **Neither node's `fs` nor a `Blob` read can be cancelled**, so
`LocalFile` and `BlobFile` check it either side of the read: the read completes
regardless, but the bytes never reach a caller that gave up and the promise
rejects like every other implementation's. Cancellation is uniform at the API;
it is not a promise the work stopped. A per-call signal wins over the
constructor's, which wins over one smuggled through `overrides`.

The range-header and progress behaviors have their reasoning in
[optimizations.md](optimizations.md#requests).

## Constructor options

```js
new LocalFile(path, { cacheFd, fdIdleTimeoutMs })
new RemoteFile(url, { fetch, headers, overrides, signal })
new BlobFile(blob)
```

`LocalFile`'s two are the descriptor policy, explained in
[local-files.md](local-files.md):

- `cacheFd` (default `true`) — hold one descriptor across reads
- `fdIdleTimeoutMs` (default `30000`) — release it after this long with no read;
  `0` holds it until `close()`

## Extending `RemoteFile`

Two seams, and picking the wrong one costs most of the read:

| override                                       | when                               |
| ---------------------------------------------- | ---------------------------------- |
| `protected fetchBytes(length, position, opts)` | you can produce the bytes          |
| `public fetch(input, init?)`                   | you want requests made differently |

The motivating case for the first is a range cache. With only `fetch` to
override, a subclass holding the bytes had to wrap them in a `Response` that
`read()` immediately unwrapped — measured against JBrowse's
`RemoteFileWithRangeCache`, fully warm with no network involved, that round trip
was **69-77% of the entire read** (0.36 → 0.08 ms at 0.25MB, 6.15 → 1.90 ms at
16MB), which is the whole cost of a cache hit.

```js
class CachingFile extends RemoteFile {
  async fetchBytes(length, position, opts) {
    const hit = this.cache.get(length, position)
    return hit ?? super.fetchBytes(length, position, opts)
  }
}
```

`read()` keeps argument validation and the zero-length short circuit in front of
the seam, so every subclass gets those. Everything HTTP — 416 handling,
`Content-Range` size recording, the over-delivery slice — lives _inside_ the
default `fetchBytes`, so an override is not silently opting out of a correctness
fix it needed; it is opting out of HTTP, which it has already replaced. Delegate
with `super` for reads you cannot serve. `stat()` runs through `read()`, so it
goes through an override too.

Override `fetch` for auth, logging, retries or proxying. The constructor's
`fetch` option is usually better than subclassing: it sits _below_ the base
implementation, so the Chrome cached-CORS retry and error wrapping still apply
to whatever it returns. If you are constructing a `Response` around bytes you
already have, you want `fetchBytes` instead.

## Types

`BufferEncoding` is declared here rather than imported from `@types/node`, so
consuming code does not need node's types to typecheck a `readFile` call.
`ReadFileOptions` is `FilehandleOptions` without `encoding` (the bytes
overload); `ReadFileTextOptions` is an encoding string or options carrying one
(the string overload).
