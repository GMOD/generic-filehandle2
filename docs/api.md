# API

Three classes implement a single interface, `GenericFilehandle`:

| class        | reads from      | where it runs                                   |
| ------------ | --------------- | ----------------------------------------------- |
| `LocalFile`  | a path on disk  | node only, and is stubbed out in browser builds |
| `RemoteFile` | an HTTP(S) URL  | anywhere `fetch` exists                         |
| `BlobFile`   | a `Blob`/`File` | anywhere `Blob` exists                          |

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

Consumers should accept the interface rather than any particular class, which is
what lets `@gmod/bam`, `@gmod/tabix`, `@gmod/bbi` and the rest work without ever
learning whether the bytes came from a disk, from a server, or from a file the
user dragged into a browser tab.

## `read(length, position, opts?)`

Reads that many bytes starting at that byte offset. The result is typed
`Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`, which promises the
buffer underneath is not a `SharedArrayBuffer`, so it can be transferred to a
worker and decoded by `TextDecoder`.

All three implementations behave the same way at the edges:

- Reading past the end of the file returns whatever bytes were left, and reading
  entirely past it returns an empty array, rather than throwing.
- A length of zero returns an empty array without touching the source.
- `RemoteFile` throws a `TypeError` for an offset that is negative, fractional
  or `NaN`, naming both the length and position it was given.

[optimizations.md](optimizations.md#reads) explains what each of those is for.

## `readFile(options?)`

Reads the whole file, resolving to a `Uint8Array<ArrayBuffer>`, or to a `string`
when an encoding is given. The two overloads make that a compile-time
distinction, so the caller does not have to narrow a `Uint8Array | string` union
afterwards.

Both spellings of utf8 are accepted everywhere. `LocalFile` passes the option
through to node's own `readFile` and therefore takes any encoding node takes,
while `RemoteFile` and `BlobFile` decode utf8 and throw
`unsupported encoding: <x>` for anything else. Every implementation accepts
either a bare encoding string or an options object:

```js
await file.readFile('utf8')
await file.readFile({ encoding: 'utf8', signal })
```

## `stat()`

Resolves to `{ size: number }`. `LocalFile` calls node's `stat` and `BlobFile`
reads `blob.size`. `RemoteFile` has no way to ask directly, so it learns the
size as a side effect of reading, as described in
[optimizations.md](optimizations.md#stat-costs-at-most-one-small-read). When
CORS hides the `Content-Range` header it resolves to `{ size: 0 }` rather than
throwing, so a caller that only wants to display a size degrades instead of
failing.

## `close()`

Releases whatever the handle is holding on to, which in practice means the file
descriptor that `LocalFile` keeps open. It is a hint that the caller is finished
rather than a teardown: reading afterwards simply opens the file again, and
calling it twice is harmless. [local-files.md](local-files.md) describes that
lifecycle, including the idle timeout that closes the descriptor for you.

## Options

`FilehandleOptions` can be passed to any individual call, and to the
`RemoteFile` constructor. Everything other than `signal` and `encoding` applies
to `RemoteFile` only.

| option       | type                                      | notes                                                                                            |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `signal`     | `AbortSignal`                             | described below                                                                                  |
| `headers`    | `Record<string, string>`                  | merged into every request, except that a range header set by the library wins over a caller's    |
| `overrides`  | `Omit<RequestInit, 'headers'>`            | extra `fetch` parameters, applied over the `method`, `redirect` and `mode` defaults set here     |
| `encoding`   | `BufferEncoding`                          | `readFile` only                                                                                  |
| `fetch`      | `(input, init?) => Promise<Response>`     | defaults to `globalThis.fetch`, and the response it returns need not be the platform's own class |
| `onProgress` | `(bytesReceived: number, total?) => void` | opt-in, and switches the read to a streaming path that reports at most one tick every 50ms       |

`RemoteFile` passes the signal to `fetch`, which genuinely cancels the request
in flight. Neither node's `fs` nor a `Blob` read can be cancelled once started,
so `LocalFile` and `BlobFile` instead check the signal on both sides of the
read: the read runs to completion, but its bytes never reach a caller that has
given up, and the promise rejects as any other implementation's would.
Cancellation therefore behaves uniformly at the API, but it is not a promise
that the underlying work stopped. A signal passed to an individual call takes
precedence over one given to the constructor, which in turn takes precedence
over one passed through `overrides`.

## Constructor options

```js
new LocalFile(path, { cacheFd, fdIdleTimeoutMs })
new RemoteFile(url, { fetch, headers, overrides, signal })
new BlobFile(blob)
```

`LocalFile`'s two options control how it manages its file descriptor, which
[local-files.md](local-files.md) explains in full:

- `cacheFd`, default `true`, keeps one descriptor open across reads instead of
  opening and closing one for every read.
- `fdIdleTimeoutMs`, default `30000`, closes that descriptor once nothing has
  read from the file for that long. Setting it to `0` keeps it open until
  `close()` is called.

## Extending `RemoteFile`

Override `protected fetchBytes(length, position, opts)` when you can produce the
bytes yourself, and `public fetch(input, init?)` when you want the requests
themselves made differently.

The case that motivated the first is
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle),
which caches byte ranges underneath a parser. When `fetch` was the only thing a
subclass could override, a subclass that already held the bytes had to wrap them
in a `Response` that `read()` would immediately unwrap again. Measured on that
class with its cache fully warm and no network involved, that round trip
accounted for **69-77% of the entire read** — 0.36ms against 0.08ms for a 0.25MB
read, and 6.15ms against 1.90ms for a 16MB one — which is essentially the whole
cost of a cache hit.

```js
class CachingFile extends RemoteFile {
  async fetchBytes(length, position, opts) {
    const hit = this.cache.get(length, position)
    return hit ?? super.fetchBytes(length, position, opts)
  }
}
```

`read()` validates its arguments and handles a zero-length read before reaching
the seam, so every subclass gets both for free. Everything HTTP-specific lives
inside the default `fetchBytes`, so a subclass that replaces it is opting out of
HTTP, which it has already replaced anyway, rather than out of a correctness fix
it needed. Note that `stat()` reads through `read()`, so it goes through an
override too.

Supplying a `fetch` through the constructor is usually better than subclassing
it, because it sits below the base implementation, so the Chrome CORS retry and
the error wrapping still apply to whatever it returns.

## Types

`BufferEncoding` is declared in this package rather than imported from
`@types/node`, so that consuming code does not need node's types installed to
typecheck a call to `readFile`. `ReadFileOptions` is `FilehandleOptions` without
`encoding`, which is the overload returning bytes, and `ReadFileTextOptions` is
either an encoding string or an options object carrying one, which is the
overload returning a string.
