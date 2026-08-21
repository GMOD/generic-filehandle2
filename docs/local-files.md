# Local files and the file descriptor

When you open a `LocalFile`, it opens the underlying file once and keeps that
file descriptor open across reads, then closes it again once nothing has read
from the file for 30 seconds. This document explains why each of those two
things is the default. None of it applies in a browser build, where `LocalFile`
is replaced by a stub that rejects every call, as described in
[browser-builds.md](browser-builds.md).

## Why keep a descriptor open across reads

The original implementation opened the file and closed it again on every single
read. For a reader that streams a whole file in one go, that costs nothing
measurable. For an indexed reader it is most of the read, because a single BAM
query is somewhere between 6 and 20 reads of a few tens of kilobytes each, plus
the index reads that come before them, and each one of those was paying for an
`open` and a `close` of its own.

Two runs on the same machine, reading 64KB at a time from a file already in the
page cache, with the two approaches interleaved:

| a new descriptor per read | one descriptor kept open | ratio |
| ------------------------- | ------------------------ | ----- |
| 138 µs                    | 65 µs                    | 2.1x  |
| 47 µs                     | 25 µs                    | 1.9x  |

The absolute numbers move with the machine, the filesystem and the node version
— the two rows above differ by about 3x while running the same code — so take
the ratio of roughly **1.9-2.1x** and measure again on your own hardware rather
than quoting these. The saving reaches every node consumer of this package,
including command-line tools, indexing jobs, and the test suite of every sibling
repository. Passing `cacheFd: false` restores the original open-per-read
behavior exactly.

## The hazard that comes with it

A descriptor that stays open across reads can be invalidated underneath you: a
Samba mount produces `EBADF`, NFS produces `ESTALE`, and a writer that replaces
the file leaves you pointing at the old inode. Opening the file fresh on every
read cannot run into any of that, which is presumably why the original code did
it that way.

Avoiding the hazard, though, means paying twice as much on every read for every
user. Handling it instead costs a single reopen on the rare read that trips over
it. When a read fails, the object closes the descriptor it was using, opens the
file again, and retries the read once. If that second attempt also fails, its
error is thrown as-is with the real errno intact, so a file that is genuinely
missing still fails with `ENOENT` instead of retrying forever.

A read cancelled through its `AbortSignal` is deliberately not retried. A
cancellation does not mean the descriptor is unhealthy, and retrying would spend
a reopen and a second read on its way to throwing the cancellation anyway.

`test/localFileFd.test.ts` injects this fault directly, reaching into the
object's private field to close the descriptor out from under it, because a
local disk will not produce the failure on its own. One of those tests kills the
descriptor five times in a row to confirm that the retry recovers each time
rather than degrading into a loop.

## Why the descriptor is released again after an idle period

Keeping the descriptor open for the entire lifetime of the object looks like the
obvious next step, and it is wrong for two reasons, neither of which has
anything to do with speed.

The first is that consumers do not close filehandles. JBrowse opens one per
track file and never calls `close()` on any of them, which is understandable,
because the interface reads like a value rather than a resource you are meant to
release. Whatever the default is, it has to be safe for a caller who never
cleans up.

The second is that a descriptor which is never closed is not free. Open
descriptors are a per-process limit, so one per file object held forever amounts
to a slow leak over a long browsing session. Node has also deprecated closing a
`FileHandle` by garbage collection (DEP0137) and intends to make it an error, so
a descriptor that is only ever reclaimed by the garbage collector is a future
crash rather than a tidy-up.

The idle timeout bounds how long a descriptor is kept by time rather than by
trusting the caller. The timer restarts after every successful read, so it
measures the time since the last read rather than the time since the file was
opened: reads within a single query arrive milliseconds apart and never trigger
it, while a file that nothing has touched for 30 seconds gives its descriptor
back. That preserves the speedup where it matters and keeps a forgetful caller
safe, which is a combination that neither opening per read nor holding forever
can offer.

```js
new LocalFile(path) // 30s idle timeout
new LocalFile(path, { fdIdleTimeoutMs: 0 }) // keep it open until close()
new LocalFile(path, { fdIdleTimeoutMs: 5000 }) // release it sooner
new LocalFile(path, { cacheFd: false }) // open and close on every read
```

The timer is `unref`'d, so a close that is still pending never keeps a node
process alive on its own.

### `unref` is not available everywhere

`setTimeout` returns a `Timeout` object under node, but in a DOM context it
returns an opaque number, and a number has no `unref` method. Calling it there
throws `this.idleTimer.unref is not a function` from inside the read, and
neither the message nor the stack mentions a timer.

A browser build is not where this happens, since it replaces the class with a
stub that never opens anything. The environment that runs into it is Electron's
renderer process, along with anything else that resolves the node entry point
while keeping the DOM's timers. There `fs/promises` is genuinely available, so
`LocalFile` is the right class and every read works, right up until the timer is
set. In JBrowse Desktop this surfaced as a text search adapter failing with no
indication that a timer was involved.

The call is therefore guarded by a predicate that checks for the method at
runtime, and the guard is a cheap thing to be wrong about: without `unref`, all
that is lost is the timer's ability to avoid holding a process open for
`fdIdleTimeoutMs`, and a renderer has no process of its own to hold open. The
test for it replaces `globalThis.setTimeout` with the DOM signature and reads a
file through it.

It is written as a type guard rather than a `typeof` check at the call site,
because a `typeof` check leaves the member typed as a bare `Function`, which
tells TypeScript nothing about its parameters or return type, so the
`no-unsafe-call` lint rule rejects the call. Describing the shape in the
predicate is what makes the call type-checked, and it does so without a cast
anywhere.

## Concurrent reads share one open, and closing is safe at any time

An indexed reader issues its reads without awaiting between them, and six at
once is quite ordinary. If each of those reads found no descriptor and opened
one for itself, the file would be opened six times and five of those descriptors
would be thrown away immediately. So the first read stores its in-flight
`open()` as a promise and the others await that same promise. It is cleared once
it settles, either way, so a failed open does not leave the object permanently
broken.

`close()` closes the descriptor and returns. Reading afterwards simply opens the
file again, which makes `close()` a hint that the caller is finished rather than
a teardown that invalidates the object, and means a consumer that closes too
eagerly loses a little speed and nothing else.

The case that needs care is a `close()` that arrives while an `open()` is still
in flight. Dropping the reference is not enough, because the open would then
settle and install its descriptor into an object that nobody is going to call
again, leaving it open for the life of the process. So closing waits for the
pending open to settle and closes whatever it produced. Errors raised while
closing are swallowed: an `EBADF` from a network filesystem means the descriptor
is already gone, and it is being discarded either way.

## What this does not do

- **It does not bound the number of open descriptors across instances.** Each
  `LocalFile` limits only its own, so a thousand files being read at the same
  time hold a thousand descriptors between them. If that is your situation,
  lower `fdIdleTimeoutMs` or set `cacheFd: false`.
- **It cannot cancel a read that is already running**, because node's `fs` has
  no signal support on a read. See [api.md](api.md#options) for what the signal
  does instead.
- **`readFile()` and `stat()` do not use the open descriptor.** They work from
  the path, which costs one path resolution on a call that either reads the
  entire file or reads none of it.
