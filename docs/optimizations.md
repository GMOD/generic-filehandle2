# Optimizations

generic-filehandle2 implements little more than `read(length, position)` over
three kinds of source. Its optimizations are decisions about which bytes get
copied, which requests get made, and how much memory stays alive after a read
returns, and we made each one after a consumer ran into the problem it fixes.

The consumers are indexed readers, and the package is tuned for how they read:
many small positional reads, issued concurrently, against a file whose size is
not known until something asks for it. [api.md](api.md) documents the interface
itself, and [local-files.md](local-files.md) covers the file descriptor policy,
which is the largest single win in the package.

## Reads

A read of zero bytes returns an empty array immediately. For `RemoteFile` that
avoids a pointless request, and for `BlobFile` it is a correctness fix rather
than an optimization, because some browsers crash when asked to read zero bytes
from a local file. Indexed readers produce these reads from empty chunks more
often than you might expect.

Reading past the end of a file returns however many bytes were left rather than
throwing, and `RemoteFile` keeps that true over HTTP by translating a 416 Range
Not Satisfiable response into an empty read. A caller can therefore read to the
end of a file without ever learning its size, which over the network would cost
a `stat()` round trip. Indexed readers rely on this to read past a block
boundary.

`RemoteFile` rejects a length or position that is negative, fractional or `NaN`.
A corrupt index produces `NaN` through ordinary arithmetic. Without the check,
the `NaN` would reach the server as a range header the server can only reject,
and the error would appear a long way from the actual bug.

### A server that sends too much does not keep its body alive

A server that ignores the range header sends the whole file back. If the read
returned a `subarray` view of the first `length` bytes of that response, the
entire body would stay in memory for as long as the caller held those few bytes,
so a 4KB read could retain 2GB. `RemoteFile` therefore copies the requested
slice out of that response. That is the only case that copies; when the server
honored the range, `RemoteFile` returns the bytes exactly as they arrived.

The progress path in `util.ts` follows the same rule. Its pre-sized buffer is
returned as it is when it filled up exactly, and copied out when the body turned
out to be shorter, so a caller never ends up holding bytes whose underlying
`.buffer` is longer than the view over them.

## Requests

### `stat()` costs at most one small read

An HTTP client gets a file's size only by asking for it. Enough proxies and
object stores mishandle `HEAD`, the textbook way to ask, that it is unreliable,
and CORS often hides its answer besides. `stat()` therefore issues a 10-byte
ranged read instead and takes the total from the `Content-Range` header, which
comes back in the form `bytes 0-9/1234`.

`RemoteFile` also records the size from ordinary reads, on any 206 response and
any 200 response to a read at position 0, so `stat()` makes no request for a
reader that has already read anything. `readFile()` records the size too, but
only from a 200 response, since a 206 there means the caller supplied a range
header of their own, and the length of that body is unrelated to the length of
the file.

Several readers often call `stat()` at once, since it is usually the first thing
each of them does, so `RemoteFile` sends one request and every caller awaits it.
`RemoteFile` clears the shared promise once it settles, so a probe that fails
does not stop later calls from trying again.

### A caller's `Range` header cannot end up alongside ours

HTTP header names are case-insensitive, but JavaScript object keys are not. When
a caller passes `{ Range: 'bytes=0-99' }` and a ranged read adds its own
`range`, the headers object has two separate keys, and `fetch` combines them
into a single comma-joined multi-range request. The server answers that
correctly, with a `multipart/byteranges` body, and `RemoteFile` would return
that body, MIME boundaries included, to the caller as though it were file
content. The header merge therefore lowercases both sides and lets the library's
own range header win.

### Chrome's cached CORS responses get one retry

When a request that should have worked fails with `Failed to fetch` in Chrome,
the cause is often
[a CORS response that Chrome cached](https://github.com/GMOD/jbrowse-components/pull/1511)
rather than an actual network failure. `RemoteFile` retries such a request once
with `cache: 'reload'`, and logs a warning so the retry is visible.

### Only a network failure is rewrapped

A request that gets no response rejects with a bare `TypeError` that names no
URL, so `RemoteFile` rethrows that one failure as `<message> fetching <url>`,
with the original kept as `cause`. Every other error reaches the caller as
thrown. An abort arrives as the signal's own reason, and an error a custom
`fetch` throws on purpose keeps its class and name. When we wrapped those too,
every caller that recognized one by name broke, because the wrapper's name is
`Error`.

## Memory and copies

### Progress reporting streams into a single pre-sized buffer

When `onProgress` is set, the response body is streamed directly into a buffer
sized from `Content-Length`, so there is no array of chunks, no concatenation
pass at the end, and one allocation for the whole download. The streaming code
handles two cases that a naive version gets wrong. A decoded body can be longer
than `Content-Length`, because gzip transfer-encoding reports the compressed
length, so the buffer grows rather than overflowing. A malformed or missing
`Content-Length` parses to `undefined` rather than `NaN`, because a `NaN` would
pass an `=== undefined` check and corrupt every calculation downstream.

If the length is not usable there is no fraction to report, so the read falls
back to reading the body in one go and emitting a single completion tick. Ticks
are throttled to one every 50ms, because a large body arrives as thousands of
chunks and a progress bar redrawn for each one is slower than the download
itself.

Progress is opt-in because streaming runs a reader loop. A caller that omits
`onProgress` gets `Response.bytes()`, which is a single call into the platform.
Most callers here are machines rather than people, and `@gmod/bam` reading an
index should not pay for a reader loop whose output nothing will display.

### `Response.bytes()` and `instanceof Response`

`Response.bytes()` avoids the `new Uint8Array(...)` wrapper that `arrayBuffer()`
needs, but it is missing from some versions of `lib.dom.d.ts`. The fallback is
an optional chain with an eslint suppression above it, because TypeScript's
types declare the method as always defined, while older runtimes lack it.

The progress path checks for a `body` property rather than using
`instanceof Response`, because a custom `fetch` may return a response from
another realm or from another implementation entirely, and `instanceof` fails on
both. The symptom when it does is a progress bar that sits at zero for an entire
download while everything else works normally.

## Caching belongs above this package

Deciding what to keep needs the access pattern, which only the layers above a
filehandle have, so the cache belongs in those layers rather than in the
filehandle.
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle)
wraps a filehandle to cache byte ranges and coalesce a query's scattered reads
into a few requests, using the `fetchBytes` override described in
[api.md](api.md#extending-remotefile). Above that again, `@gmod/bam` and
`@gmod/tabix` cache decompressed chunks keyed by virtual offset. A filehandle
that cached bytes internally would hold memory that neither of those layers can
see or bound.
