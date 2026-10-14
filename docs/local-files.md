# The `LocalFile` descriptor and browser stub

`LocalFile` opens the file once and keeps that file descriptor open across
reads, then closes it again once nothing has read from the file for 30 seconds.
The first half of this document explains why each of those is the default. The
second half covers the stub that replaces the class in a browser build. Both
halves follow from `LocalFile` being the only class in the package that imports
from node's `fs/promises`.

## Why keep a descriptor open across reads

The original implementation opened the file and closed it again on every read.
For a reader that streams a whole file in one go that costs nothing measurable,
but for an indexed reader it is most of the read, because a single BAM query is
somewhere between 6 and 20 reads of a few tens of kilobytes each, plus the index
reads before them.

We ran the comparison twice on the same machine, reading 64KB at a time from a
file already in the page cache and interleaving the two approaches:

| a new descriptor per read | one descriptor kept open | ratio |
| ------------------------- | ------------------------ | ----- |
| 138 µs                    | 65 µs                    | 2.1x  |
| 47 µs                     | 25 µs                    | 1.9x  |

The absolute numbers vary with the machine, the filesystem and the node version;
the two rows above differ by about 3x running the same code. Take the ratio of
roughly **1.9-2.1x**, and measure on your own hardware rather than quoting
these. Every node consumer of this package gets the saving, including
command-line tools, indexing jobs, and the test suite of every sibling
repository. With `cacheFd: false`, `LocalFile` opens the file on every read,
exactly as the original implementation did.

## Recovering from a stale descriptor

An open descriptor can stop working between reads. On a Samba mount the read
fails with `EBADF`, on NFS with `ESTALE`, and a writer that replaces the file
leaves the descriptor pointing at the old inode. An open per read avoids all
three, which is presumably why the original code opened the file every time.

Opening per read doubles the cost of every read for every user, while recovering
from a stale descriptor costs one reopen on the rare read that hits one. When a
read fails, `LocalFile` closes the descriptor it was using, opens the file
again, and retries the read once. If that second attempt also fails, `LocalFile`
throws its error as-is with the real errno intact, so a missing file still fails
with `ENOENT` instead of retrying forever.

`LocalFile` does not retry a read cancelled through its `AbortSignal`, because a
cancellation does not mean the descriptor is unhealthy, and a retry would spend
a reopen and a second read before throwing the cancellation anyway.

`test/localFileFd.test.ts` closes the descriptor through the object's private
field, because a local disk will not produce the failure on its own. One of
those tests closes the descriptor five times in a row to confirm that the retry
recovers each time rather than looping.

## Why the descriptor is released again after an idle period

Keeping the descriptor open for the lifetime of the object looks like the
obvious next step, and it is wrong for two reasons, neither about speed.

First, consumers do not close filehandles. JBrowse opens one per track file and
never calls `close()` on any of them, which is understandable, because the
interface looks like a value rather than a resource to release. The default
therefore has to be safe for a caller who never cleans up.

Second, a descriptor that is never closed uses up a limited resource. The
operating system caps open descriptors per process, so holding one per file
object forever is a slow leak over a long browsing session. Node has also
deprecated closing a `FileHandle` by garbage collection (DEP0137) and intends to
make it an error, so a descriptor that only the garbage collector ever closes
would become a crash in a future node version.

The idle timeout limits how long `LocalFile` keeps a descriptor without relying
on the caller to call `close()`. The timer restarts after every successful read,
so it measures the time since the last read, not since the file was opened.
Reads within a single query arrive milliseconds apart and never trigger it,
while `LocalFile` closes the descriptor of a file that nothing has read for 30
seconds. A query's reads therefore keep the speedup, and a caller who never
calls `close()` is still safe. Opening per read loses the speedup, and holding
the descriptor forever leaks it.

```js
new LocalFile(path) // 30s idle timeout
new LocalFile(path, { fdIdleTimeoutMs: 0 }) // keep it open until close()
new LocalFile(path, { fdIdleTimeoutMs: 5000 }) // release it sooner
new LocalFile(path, { cacheFd: false }) // open and close on every read
```

`LocalFile` calls `unref()` on the timer, so a pending close does not by itself
keep a node process alive.

### Timers without `unref`

`setTimeout` returns a `Timeout` object under node, but in a DOM context it
returns an opaque number, and a number has no `unref` method. Calling it there
throws `this.idleTimer.unref is not a function` from inside the read, and
neither the message nor the stack mentions a timer.

A browser build never reaches this code, because it replaces the class with the
stub described below. The error appears in Electron's renderer process, and in
anything else that resolves the node entry point while keeping the DOM's timers.
There `fs/promises` is available, so `LocalFile` is the right class and every
read works until `LocalFile` sets the timer. In JBrowse Desktop the bug showed
up as a text search adapter failing with no indication that a timer was
involved.

`LocalFile` therefore calls `unref` only after a predicate confirms at runtime
that the method exists. When the predicate skips `unref`, the only cost is that
the timer can hold a process open for `fdIdleTimeoutMs`, and a renderer has no
process of its own to hold open. The test for the predicate replaces
`globalThis.setTimeout` with the DOM signature and reads a file through it.

The predicate is a type guard rather than a `typeof` check at the call site,
because a `typeof` check leaves the member typed as a bare `Function`, which
tells TypeScript nothing about its parameters or return type, so the
`no-unsafe-call` lint rule rejects the call. Because the predicate declares the
method's signature, TypeScript type-checks the call with no cast.

## Concurrent reads share one open, and closing is safe at any time

An indexed reader issues its reads without awaiting between them, and six at
once is quite ordinary. If each of those reads found no descriptor and opened
one for itself, the file would be opened six times and five of those descriptors
thrown away immediately. Instead, the first read stores its in-flight `open()`
as a promise and the others await that same promise. `LocalFile` clears the
promise once it settles, whether it resolved or rejected, so a failed open does
not leave the object broken.

`close()` closes the descriptor and returns. A later read opens the file again,
so a consumer that closes too early loses a little speed and nothing else.

A `close()` that arrives while an `open()` is still in flight needs care.
Dropping the reference is not enough, because the open would then settle and
store its descriptor in an object nobody calls again, leaving the descriptor
open for the life of the process. `close()` therefore waits for the pending open
to settle and closes whatever it produced. `close()` ignores errors from closing
the descriptor, because an `EBADF` from a network filesystem means the
descriptor is already gone, and `LocalFile` discards it either way.

`LocalFile` does not limit the number of open descriptors across instances, so a
thousand files being read at the same time hold a thousand descriptors between
them; lower `fdIdleTimeoutMs` or set `cacheFd: false` if that is your situation.
`readFile()` and `stat()` use the path rather than the open descriptor, which
costs one path resolution on a call that either reads the whole file or none of
it.

## In a browser build, the class becomes a stub

Because `LocalFile` is the only thing here importing `fs/promises`, the package
ships a `browser` export condition, and removing it breaks every consumer
building with Vite:

```
"open" is not exported by "__vite-browser-external"
```

Vite, webpack and Rollup all resolve that condition when building for the
browser, and it points at `esm/browser.js` or `dist/browser.js`, which is the
same entry point with the real `LocalFile` left out and a stub that rejects
every call put in its place.

```json
"exports": {
  "browser": { "import": "./esm/browser.js", "require": "./dist/browser.js" },
  "import": "./esm/index.js",
  "require": "./dist/index.js"
}
```

The order of those keys matters. `browser` comes first so that a bundler which
supports the condition takes it, while node, which does not implement that
condition at all, falls through to `import` or `require` and gets the real
class.

The stub is a typed class, not `undefined` or a class whose methods take `any`.
Every member has the full signature of the real one, including both `readFile`
overloads, and the class declares `implements GenericFilehandle`, so a stub that
no longer matches the interface fails to compile here instead of breaking inside
somebody else's bundle. The stub exists so that code written against
`LocalFile`, such as a JBrowse adapter that picks a filehandle by URI scheme,
still typechecks in a bundle that resolves the `browser` condition, even though
calling it would fail at runtime. For the same reason, the constructor accepts
its parameters and ignores them. The error therefore comes only when the bundle
tries to read a local file, and it names the path the constructor was given
(`LocalFile is unimplemented in the browser (/path/to/file)`).

JBrowse Desktop bypasses the `browser` condition with a hardcoded webpack alias
to `dist/index.js`, so its renderer always gets the node build it wants. The
renderer therefore runs the real `LocalFile`, which is why the `unref` guard
above matters there.

### Only `pnpm test:pack` can catch a broken export map

`pnpm test` runs against `src/`, so it never sees the `exports` field, the build
outputs, or the condition a bundler would resolve, and a missing build output or
a flattened export map would ship without a single test failing.

`scripts/test-pack.sh`, run as `pnpm test:pack` and required by `preversion`,
packs the real tarball, installs it into a scratch directory, and imports it as
ESM, as CJS, and under `--conditions=browser`. The browser import checks that
`LocalFile` is still exported as a constructor and that calling it rejects. The
script is the repository's only test of the browser condition; without it, a
broken condition would first fail in a consumer's build.

Anything new that imports `fs`, `path`, `os` or similar has to live behind the
same split, real in `index.ts` and stubbed in `browser.ts`, or not exist at all.
