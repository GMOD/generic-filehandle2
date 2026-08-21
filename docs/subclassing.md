# Extending RemoteFile

There are two seams, and picking the wrong one costs most of the read.

| override                                       | when                                     |
| ---------------------------------------------- | ---------------------------------------- |
| `protected fetchBytes(length, position, opts)` | you can produce the bytes yourself       |
| `public fetch(input, init?)`                   | you want to change how requests are made |

Overriding neither leaves the default ranged GET, and the default `fetchBytes`
goes through `this.fetch`, so a subclass that only wraps `fetch` keeps working
untouched.

## `fetchBytes`, for anything holding bytes

The motivating case is a range cache: a subclass that keeps byte ranges it has
already downloaded and answers repeat reads out of memory.

Before this seam existed, `fetch` was the only override point, so such a
subclass had to wrap its cached bytes in a `Response` — which `read()` then
immediately unwrapped again. Both halves copy.

Measured against JBrowse's `RemoteFileWithRangeCache` with the cache fully warm
and no network in the picture at all:

| read size | via `Response` | direct bytes | saved |
| --------- | -------------- | ------------ | ----- |
| 0.25 MB   | 0.36 ms        | 0.08 ms      | 77%   |
| 1 MB      | 0.34 ms        | 0.08 ms      | 76%   |
| 4 MB      | 1.36 ms        | 0.42 ms      | 69%   |
| 16 MB     | 6.15 ms        | 1.90 ms      | 69%   |

That is the whole cost of a cache hit — the lookup is a map read. Everything in
the left column is `Response` construction and teardown around bytes that were
already sitting in memory.

```js
class CachingFile extends RemoteFile {
  async fetchBytes(length, position, opts) {
    const hit = this.cache.get(length, position)
    return hit ?? super.fetchBytes(length, position, opts)
  }
}
```

What the base class keeps in front of the seam:

- **argument validation** — `NaN`/negative/fractional offsets throw before an
  override ever sees them, so every subclass gets that check for free
- **the zero-length short circuit**
- **nothing else.** 416 handling, `Content-Range` size recording and the
  over-delivery slice all live _inside_ the default `fetchBytes`, so an override
  that serves its own bytes is not silently opting out of correctness fixes it
  needed — it is opting out of HTTP, which it has already replaced.

An override that serves some reads and delegates the rest should call `super`,
as above, rather than reimplementing the request.

Note that `stat()` runs through `read()`, so it goes through an override too. A
subclass serving bytes from a cache answers `stat()` without a request, as long
as something has recorded a size.

## `fetch`, for how requests are made

Auth headers, logging, retry policy, proxying, request signing — anything that
still ends in an HTTP request. Two ways in, and the constructor option is
usually the better one:

```js
new RemoteFile(url, {
  fetch: (input, init) =>
    globalThis.fetch(input, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${token}` },
    }),
})
```

Subclassing `fetch` instead gets you the base implementation's Chrome
cached-CORS retry and error wrapping if you call `super.fetch`; supplying
`opts.fetch` sits _below_ those, so they still apply to whatever you return.

If you find yourself constructing a `Response` around bytes you already have,
you want `fetchBytes` instead. That is the entire lesson of the table above.

## Headers, and what a subclass cannot override

The library's own range header wins over a caller's, case-insensitively — see
[optimizations.md](optimizations.md#a-callers-range-header-cannot-double-up-with-ours).
A subclass that needs to issue a different range should override `fetchBytes`
and make its own request, rather than trying to smuggle a header through.

`overrides` beats the library's `method`/`redirect`/`mode` defaults, so those
are yours to change from the constructor without subclassing anything.
