# Optimizations

This package is thin on purpose — it is `read(length, position)` over three
sources — so nothing here is a clever algorithm. What it has instead is a set of
decisions about **bytes that get copied, requests that get made, and memory that
stays retained after a read returns**, each of which came from a consumer
hitting it.

The consumers are indexed readers. Their shape is what everything below is tuned
for: many small positional reads, issued concurrently, against a file whose size
is unknown until something asks.

[api.md](api.md) documents the surface. [local-files.md](local-files.md) covers
the descriptor policy, which is the single largest win in the package and is not
repeated here.

## Reads

### Zero-length reads never reach the source

`read(0, pos)` returns an empty array immediately in all three implementations.
For `RemoteFile` that saves a pointless request; for `BlobFile` it is a
correctness fix, because some browsers crash on a zero-byte read of a local
file. Indexed readers generate these from empty chunks more often than you would
expect.

### EOF without a size oracle

Reading past the end returns a short read, or an empty array, rather than
throwing. `RemoteFile` goes out of its way to keep that true: an HTTP **416
Range Not Satisfiable** is translated into an empty read.

That is what lets a caller walk to the end of a file without a size at all. The
alternative is `stat()` before every speculative read, which for a remote file
is another round trip — and the whole reason indexed readers over-read past a
block boundary instead of asking how long the file is.

### An over-delivering server does not pin its body

A server that ignores the range header sends the entire file. Returning a
`subarray` view of the first `length` bytes would keep the **whole body** alive
for as long as the caller holds those few bytes — a 4KB read retaining 2GB.

So the over-delivery case copies the requested slice out, and only that case:
the common path, where the server honored the range, returns the bytes as they
came with no copy at all.

The same reasoning appears in the progress path in `util.ts`. Its pre-sized
buffer is returned as-is when it filled exactly, and copied out when the body
came up short — otherwise the caller receives bytes whose `.buffer` is longer
than the view over it, which is the kind of thing that goes wrong three
libraries downstream.

## Requests

### `stat()` costs one small read, at most

HTTP gives no size without asking. A `HEAD` request is the textbook answer and
is unreliable in practice — proxies and object stores mishandle it, and CORS
often hides the headers.

So `stat()` issues a 10-byte ranged read and takes the total out of the
`Content-Range` (`bytes 0-9/1234`). More usefully, **every read already does
that**: any 206, and any 200 at position 0, records the size on the way past. A
reader that has read anything gets its `stat()` for free.

Failure degrades rather than throws. If CORS hides `Content-Range`, `stat()`
returns `{ size: 0 }` — a caller displaying a size shows nothing instead of
crashing a track.

`readFile()` records the size too, but only from a 200: a 206 there means the
caller supplied their own range header, and the body length says nothing about
the file.

### Concurrent `stat()` calls share one probe

Several readers calling `stat()` on the same file at once is normal — it is
usually the first thing each of them does. They share a single in-flight probe
rather than each firing a request.

The promise is cleared once it settles, so a failed probe does not poison the
object; the next `stat()` tries again.

### A caller's `Range` header cannot double up with ours

HTTP header names are case-insensitive; JavaScript object keys are not. A caller
passing `{ Range: 'bytes=0-99' }` and a ranged read adding `range` produce **two
keys**, and `fetch` folds them into one comma-joined multi-range request. The
server answers correctly, with a `multipart/byteranges` body — and that body,
MIME boundaries and all, gets handed back as file bytes.

So the merge lowercases both sides and lets the library's range win. A caller
who wants a specific range should ask for it with `read(length, position)`,
which is the whole API.

### Chrome's cached-CORS bug gets one retry

A `Failed to fetch` from a fetch that should have worked is, in Chrome, often
[a cached CORS response](https://github.com/GMOD/jbrowse-components/pull/1511)
rather than a network failure. The request is retried once with
`cache: 'reload'`, with a console warning so it is visible rather than magic.
Anything else is wrapped with the URL and rethrown, `cause` preserved.

## Memory and copies

### Progress reporting streams into one pre-sized buffer

With `onProgress` set, the response body is streamed and written directly into a
buffer sized from `Content-Length`. No per-chunk array, no concatenation pass at
the end, one allocation for the whole download.

Two things the naive version gets wrong, both handled:

- **A decoded body can exceed `Content-Length`** — gzip transfer-encoding
  reports the compressed length. The buffer grows rather than overflowing.
- **A malformed or missing `Content-Length`** must not become `NaN`. It is
  parsed to `undefined`, which fails an `=== undefined` check honestly instead
  of poisoning every arithmetic use downstream.

Without a usable length there is no fraction to report, so it falls back to a
one-shot read and a single completion tick instead of buffering chunks for
nothing.

Ticks are throttled to 50ms. A large body yields thousands of chunks, and a
progress bar redrawn per chunk is slower than the download.

### Progress is opt-in because streaming is not free

Omitting `onProgress` keeps `Response.bytes()`, which is one call into the
platform. That is the default because most callers are machines, not people:
`@gmod/bam` reading an index does not want a progress bar, and should not pay
for the reader loop that would drive one.

### `Response.bytes()` where available, `arrayBuffer()` otherwise

`bytes()` skips the extra `new Uint8Array(...)` wrapper. It is widely available
but not in every `lib.dom.d.ts`, so the check is written as an optional chain
with an eslint suppression — TypeScript believes it is always defined, and older
runtimes disagree.

### Duck-typing a `Response`

The progress path tests for a `body` property rather than `instanceof Response`.
A custom `fetch` may return a `Response` from another realm or another
implementation entirely, and `instanceof` fails on both — the symptom being a
progress bar stuck at zero for an entire download, with everything else working.

## Consumers

### Serving bytes from a subclass

The `fetchBytes` seam exists because a caching subclass that already holds the
bytes was forced to wrap them in a `Response` for `read()` to immediately
unwrap. On a fully warm cache with no network involved, that round trip was
**69-77% of the entire read**. [subclassing.md](subclassing.md) has the numbers.

### What the readers add

Byte-range caching lives in the consumers, not here, and that is the right place
for it: only the reader knows which byte ranges it will ask for twice.
`@gmod/bam` and `@gmod/tabix` cache decompressed chunks keyed by virtual offset;
JBrowse layers a range cache over `RemoteFile` via the seam above.

A filehandle that cached bytes itself would be caching the wrong unit — raw byte
ranges that rarely repeat exactly — while holding memory the reader cannot see
or bound.
