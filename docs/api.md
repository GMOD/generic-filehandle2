# API

Three classes implement a single interface, `GenericFilehandle`:

| class        | reads from      | where it runs                                   |
| ------------ | --------------- | ----------------------------------------------- |
| `LocalFile`  | a path on disk  | node only, and is stubbed out in browser builds |
| `RemoteFile` | an HTTP(S) URL  | anywhere `fetch` exists                         |
| `BlobFile`   | a `Blob`/`File` | anywhere `Blob` exists                          |

```ts
interface GenericFilehandle {
  readonly source?: string
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

Consumers should accept the interface rather than any particular class.
`@gmod/bam`, `@gmod/tabix`, `@gmod/bbi` and the rest do, so the same parser code
reads bytes from a disk, from a server, or from a file the user dragged into a
browser tab.

## `read(length, position, opts?)`

Reads that many bytes starting at that byte offset. The result type is
`Uint8Array<ArrayBuffer>`, not plain `Uint8Array`, which rules out a
`SharedArrayBuffer` underneath, so the caller can transfer the buffer to a
worker and decode it with `TextDecoder`.

`LocalFile`, `RemoteFile` and `BlobFile` handle the edge cases the same way:

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

Every implementation accepts both `utf8` and `utf-8`. `LocalFile` passes the
option through to node's own `readFile` and therefore takes any encoding node
takes, while `RemoteFile` and `BlobFile` decode utf8 and throw
`unsupported encoding: <x>` for anything else. Every implementation accepts
either a bare encoding string or an options object:

```js
await file.readFile('utf8')
await file.readFile({ encoding: 'utf8', signal })
```

## `stat()`

Resolves to `{ size: number }`. `LocalFile` calls node's `stat`, so its result
also contains `mtimeMs` and `ino`. A cache in front of the file needs those to
tell a rewritten file from the one it read. `BlobFile` reads `blob.size`.
`RemoteFile` has no direct request for the size, so it records the size from the
responses to its reads, as described in
[optimizations.md](optimizations.md#stat-costs-at-most-one-small-read). When
CORS hides the `Content-Range` header, `stat()` resolves to `{ size: 0 }` rather
than throwing, so a caller that only wants to display a size still gets a
result.

## `close()`

Releases whatever the handle is holding on to, which in practice means the file
descriptor that `LocalFile` keeps open. The handle stays usable afterwards,
because a later read opens the file again, and a second `close()` is harmless.
[local-files.md](local-files.md) describes the descriptor's lifecycle, including
the idle timeout that closes the descriptor for you.

## `source`

`source` is the path or URL the handle reads from, so a caller can report which
file a slow or stuck read is waiting on without knowing the handle's class.

| class        | `source`           |
| ------------ | ------------------ |
| `LocalFile`  | the path it reads  |
| `RemoteFile` | the URL it fetches |
| `BlobFile`   | `undefined`        |

`BlobFile` leaves `source` undefined on purpose, because the page handed it
bytes that have no address anyone could look up. A caller that labels a read by
its file therefore gets a real path or URL, or nothing.

`source` is the string the handle was constructed with, unchanged. A relative
URL stays relative, and a presigned URL keeps the `?X-Amz-Signature=...` that is
a credential. The caller that displays `source` is responsible for resolving it,
or for redacting it before a person can read it.

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

`RemoteFile` passes the signal to `fetch`, which cancels the request in flight.
A read from node's `fs` or from a `Blob` cannot be cancelled once started, so
`LocalFile` and `BlobFile` check the signal before and after the read. The read
runs to completion, and the promise then rejects as it would in `RemoteFile`, so
the bytes never reach a caller that has given up. An abort therefore rejects the
call in all three classes, although in `LocalFile` and `BlobFile` the disk or
blob read still finishes. A signal passed to an individual call takes precedence
over one given to the constructor, which in turn takes precedence over one
passed through `overrides`.

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
  read from the file for that long. With `0`, the descriptor stays open until
  `close()` is called.

## Extending `RemoteFile`

Override `protected fetchBytes(length, position, opts)` when you can produce the
bytes yourself, and `public fetch(input, init?)` when you want the requests
themselves made differently.

We added `fetchBytes` for
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle),
which caches byte ranges underneath a parser. When `fetch` was the only method a
subclass could override, a subclass that already held the bytes had to wrap them
in a `Response` that `read()` would immediately unwrap again. On that class,
with its cache fully warm and no network involved, the wrap and unwrap took
**69-77% of the entire read**, nearly the whole cost of a cache hit: 0.36ms
against 0.08ms for a 0.25MB read, and 6.15ms against 1.90ms for a 16MB one.

```js
class CachingFile extends RemoteFile {
  async fetchBytes(length, position, opts) {
    const hit = this.cache.get(length, position)
    return hit ?? super.fetchBytes(length, position, opts)
  }
}
```

`read()` validates its arguments and handles a zero-length read before it calls
`fetchBytes`, so an override needs to do neither. A subclass that still makes
the request itself builds its `RequestInit` with
`protected buildRequest(opts, extraHeaders?)`, which merges the constructor's
headers, overrides and signal with the per-call ones exactly as the base class
does.

`protected readFileBody(res, encoding, onProgress?)` is the matching override
for `readFile()`, which calls it after checking the response status. An override
can therefore run code before and after the body is read, which an override of
`fetch` cannot, because `fetch` returns as soon as the headers arrive.

The default `fetchBytes` contains all the HTTP-specific code, so a subclass that
replaces it drops only the HTTP handling, which it has replaced anyway, and
keeps every correctness fix it needs. `stat()` calls `read()`, so an override of
`fetchBytes` serves `stat()` too.

To change how requests are made, passing a `fetch` to the constructor is usually
better than overriding the `fetch` method. The base `fetch` method calls the
constructor's `fetch`, so the Chrome CORS retry and the error wrapping still
apply to whatever it returns.

## Types

`BufferEncoding` is declared in this package rather than imported from
`@types/node`, so that consuming code does not need node's types installed to
typecheck a call to `readFile`. `ReadFileOptions` is `FilehandleOptions` without
`encoding`, which is the overload returning bytes, and `ReadFileTextOptions` is
either an encoding string or an options object with one, which is the overload
returning a string. `LocalFileOptions` types the second argument of the
`LocalFile` constructor, which holds `cacheFd` and `fdIdleTimeoutMs`.

`stat()` resolves to a `Stats`, which declares `size` and the optional `mtimeMs`
and `ino` that only `LocalFile` sets. `Fetcher` types the `fetch` option, with
the signature of `globalThis.fetch`, and `ProgressCallback` types `onProgress`.
