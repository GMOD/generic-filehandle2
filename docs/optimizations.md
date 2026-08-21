# Optimizations

This package is not much more than `read(length, position)` over three kinds of
source, so nothing in it is a clever algorithm. What it does have is a set of
decisions about which bytes get copied, which requests get made, and how much
memory stays alive after a read returns. Every one of them came from a consumer
running into it.

Those consumers are indexed readers, and the way they read is what all of this
is tuned for: many small positional reads, issued concurrently, against a file
whose size is not known until something asks for it. [api.md](api.md) documents
the interface itself, and [local-files.md](local-files.md) covers the file
descriptor policy, which is the largest single win in the package.

## Reads

### A zero-length read never reaches the source

`read(0, pos)` returns an empty array immediately. For `RemoteFile` that avoids
a pointless request. For `BlobFile` it is a correctness fix rather than an
optimization, because some browsers crash when asked to read zero bytes from a
local file. Indexed readers produce these from empty chunks more often than you
might expect.

### Detecting the end of a file without asking how long it is

Reading past the end of a file returns however many bytes were left, or an empty
array if there were none, rather than throwing. `RemoteFile` keeps that true
over HTTP by translating a 416 Range Not Satisfiable response into an empty
read.

That is what allows a caller to walk to the end of a file without ever learning
its size. The alternative would be calling `stat()` before every speculative
read, which over the network means another round trip, and it is the reason
indexed readers deliberately read past a block boundary instead of asking how
long the file is.

### A server that sends too much does not keep its body alive

A server that ignores the range header sends the whole file back. If the read
returned a `subarray` view of the first `length` bytes of that response, the
entire body would stay in memory for as long as the caller held on to those few
bytes, so a 4KB read could retain 2GB. That case therefore copies the requested
slice out. It is the only case that copies: when the server honored the range,
the bytes are returned exactly as they arrived.

The progress path in `util.ts` follows the same rule. Its pre-sized buffer is
returned as it is when it filled up exactly, and copied out when the body turned
out to be shorter, so a caller never ends up holding bytes whose underlying
`.buffer` is longer than the view over them.

## Requests

### `stat()` costs at most one small read

HTTP will not tell you how large a file is without being asked, and `HEAD`, the
textbook way to ask, is mishandled by enough proxies and object stores to be
unreliable, and is often hidden by CORS besides. So `stat()` issues a 10-byte
ranged read instead and takes the total from the `Content-Range` header, which
comes back in the form `bytes 0-9/1234`.

More usefully, every read already does this. Any 206 response, and any 200
response to a read at position 0, records the size on its way past, so a reader
that has read anything at all gets its `stat()` for free. If CORS hides the
header, `stat()` returns `{ size: 0 }` instead of throwing, so a caller that
only wanted to display a size shows nothing rather than failing a whole track.

`readFile()` records the size too, but only from a 200 response. A 206 there
means the caller supplied a range header of their own, and the length of that
body says nothing about the length of the file.

### Concurrent `stat()` calls share a single request

Several readers calling `stat()` on the same file at once is normal, since it is
usually the first thing each of them does, so they all await one in-flight
request rather than each issuing their own. The shared promise is cleared once
it settles, so a probe that fails does not prevent later calls from trying
again.

### A caller's `Range` header cannot end up alongside ours

HTTP header names are case-insensitive, but JavaScript object keys are not. A
caller passing `{ Range: 'bytes=0-99' }` and a ranged read adding its own
`range` therefore produce two separate keys, and `fetch` combines them into a
single comma-joined multi-range request. The server answers that correctly, with
a `multipart/byteranges` body, and that body — MIME boundaries and all — would
be handed back to the caller as though it were file content.

The header merge therefore lowercases both sides and lets the library's own
range header win. A caller who wants a particular range asks for it through
`read(length, position)`.

### Chrome's cached CORS responses get one retry

When a request that should have worked fails with `Failed to fetch` in Chrome,
the cause is often
[a CORS response that Chrome cached](https://github.com/GMOD/jbrowse-components/pull/1511)
rather than an actual network failure. Such a request is retried once with
`cache: 'reload'`, and a warning is logged so that the retry is visible rather
than mysterious. Any other failure is wrapped with the URL it came from and
rethrown, with the original error kept as `cause`.

## Memory and copies

### Progress reporting streams into a single pre-sized buffer

When `onProgress` is set, the response body is streamed directly into a buffer
sized from `Content-Length`, so there is no array of chunks, no concatenation
pass at the end, and one allocation for the whole download. There are two things
a naive version of this gets wrong, and both are handled:

- A decoded body can be longer than `Content-Length`, because gzip
  transfer-encoding reports the compressed length. The buffer grows rather than
  overflowing.
- A malformed or missing `Content-Length` is parsed to `undefined` rather than
  `NaN`, which would otherwise pass an `=== undefined` check and go on to poison
  every calculation downstream.

If the length is not usable there is no fraction to report, so the read falls
back to reading the body in one go and emitting a single completion tick,
instead of buffering chunks for no reason. Ticks are throttled to one every
50ms, because a large body arrives as thousands of chunks and a progress bar
redrawn for each one is slower than the download itself.

Progress is opt-in because streaming is not free. A caller that omits
`onProgress` gets `Response.bytes()`, which is a single call into the platform.
Most callers here are machines rather than people, and `@gmod/bam` reading an
index should not pay for a reader loop whose output nothing will display.

### Two details about the platform

`Response.bytes()` avoids the `new Uint8Array(...)` wrapper that `arrayBuffer()`
needs, but it is missing from some versions of `lib.dom.d.ts`. That is why the
fallback is written as an optional chain with an eslint suppression above it:
TypeScript believes the method is always there, and older runtimes disagree.

The progress path checks for a `body` property rather than using
`instanceof Response`, because a custom `fetch` may return a response from
another realm or from another implementation entirely, and `instanceof` fails on
both. The symptom when it does is a progress bar that sits at zero for an entire
download while everything else works normally.

## Caching belongs above this package

Only a layer that knows the access pattern knows what is worth keeping, so
caching lives above the filehandle rather than inside it.
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle)
wraps a filehandle to cache byte ranges and coalesce a query's scattered reads
into a few requests, which it does through the `fetchBytes` seam described in
[api.md](api.md#extending-remotefile) — skipping the round trip through a
`Response` there was worth 69-77% of a warm read. Above that again, `@gmod/bam`
and `@gmod/tabix` cache decompressed chunks keyed by virtual offset.

A filehandle that cached bytes internally would hold memory that neither of
those layers can see or bound.
