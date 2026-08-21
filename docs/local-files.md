# Local files and the descriptor

`LocalFile` holds one file descriptor open across reads and closes it once
nothing has read from it for 30 seconds. Both halves of that sentence are
choices with consequences, and this document is why each one is the default.

Nothing here applies in a browser build, where `LocalFile` is a stub that
rejects every call — see [browser-builds.md](browser-builds.md).

## Why hold a descriptor at all

The original implementation opened and closed a descriptor on every read. For a
reader that streams a whole file that costs nothing measurable. For an
**indexed** reader it is most of the read: a single BAM query is 6-20 reads of a
few tens of kilobytes each, plus the index reads in front of them, and every one
of those paid an `open` and a `close`.

Two runs on the same machine, 64KB reads of a warm file, arms interleaved:

| open-per-read | held descriptor | ratio |
| ------------- | --------------- | ----- |
| 138 µs        | 65 µs           | 2.1x  |
| 47 µs         | 25 µs           | 1.9x  |

Absolute numbers move with the machine, the filesystem, and the node version —
the two rows above differ by ~3x on the same code. Take the ratio, which held
steady at roughly **1.9-2.1x**, and re-measure rather than quoting these.

This affects every node consumer: CLI tools, indexing jobs, and the test suite
of every sibling repo.

`cacheFd: false` restores open-per-read exactly, and is the escape hatch if any
of what follows is unwelcome in your environment.

## The hazard, and why it is handled rather than avoided

A descriptor held across reads can be invalidated underneath you. A Samba mount
produces `EBADF`; NFS produces `ESTALE`; a file replaced by a writer leaves the
old inode. Open-per-read cannot hit this, which is presumably why the original
code did it — the old comment gestured at exactly this risk.

Avoiding the hazard costs 2x on every read of every user. Handling it costs a
reopen on the rare read that trips it:

- a failed read **drops the descriptor, reopens, and retries once**
- the second attempt throws whatever it throws, with its real errno intact, so a
  genuinely missing file still fails with `ENOENT` rather than looping
- an **aborted** read is never retried. A cancellation is not a sick descriptor,
  and retrying one would spend a reopen and a second read on its way to throwing
  anyway

This is what `test/localFileFd.test.ts` spends most of its length on. The fault
is injected directly — the test reaches into the private field and closes the
descriptor out from under the object — because it cannot be provoked on a local
disk. Repeated death is exercised too, five kills in a row, to prove the retry
does not degrade into a loop.

## The idle timeout

Holding a descriptor for the life of the object would be the obvious next step,
and it is wrong for two reasons that have nothing to do with performance.

**Consumers do not close filehandles.** JBrowse opens one per track file and
never calls `close()`; it is not unusual, because the interface reads like a
value rather than a resource. So the default has to survive a caller who never
tidies up.

**A descriptor never closed is not free.**

- Descriptors are a per-process limit. "One per file object, forever" is a slow
  leak in a long session, and a genome browser session opens a lot of files.
- Node **deprecated closing a `FileHandle` by garbage collection** (DEP0137) and
  intends to make it an error. A held descriptor that is only ever collected is
  a future crash, not a tidy-up.

So retention is bounded by time instead of by trust. After every successful read
the idle timer restarts, so the clock measures **time since the last read**, not
time since the descriptor opened. Reads inside a query are milliseconds apart
and never see the timeout; a file nobody has touched for 30 seconds gives its
descriptor back.

That keeps the 2x where it matters and makes a forgetful caller safe, which is
the combination neither "open per read" nor "hold forever" offers.

```js
new LocalFile(path) // 30s idle timeout
new LocalFile(path, { fdIdleTimeoutMs: 0 }) // hold until close()
new LocalFile(path, { fdIdleTimeoutMs: 5000 }) // shorter leash
new LocalFile(path, { cacheFd: false }) // no descriptor held at all
```

The timer is `unref`'d, so a pending close never holds a node process alive.

### `unref` is not always there

`setTimeout` returns a `Timeout` object under node and an opaque **number** in a
DOM context, and a number has no `unref`. Reaching for it throws
`this.idleTimer.unref is not a function` — out of the read, with nothing in the
message or the stack naming a timer.

The browser build is not where this bites, since it swaps the class for a stub.
The case that bites is **Electron's renderer**, and anything else that resolves
the node entry while keeping DOM timers: `fs/promises` is real, so `LocalFile`
is the correct class and every read works — right up until the timer. In JBrowse
Desktop it surfaced as a text search adapter failing for no visible reason.

So the call is guarded by a duck-typed predicate rather than an assertion, and
the guard is cheap to be wrong about: a missing `unref` costs only what it says,
the ability of the timer to hold a process open for `fdIdleTimeoutMs`, and in a
renderer there is no process to hold. `test/localFileFd.test.ts` replaces
`globalThis.setTimeout` with the DOM signature and reads through it.

The predicate is a type guard rather than a `typeof` check at the call site
because the latter leaves the member typed as a bare `Function`, which says
nothing about parameters or return, and `no-unsafe-call` rejects calling it.
Stating the shape in the predicate is what makes the call checked, with no cast
anywhere.

## Concurrent reads share one `open()`

An indexed reader fires its reads without awaiting between them — six at once is
ordinary. Each one finding no descriptor and opening its own would mean six
opens, five of them thrown away, and the last writer winning the field.

So an in-flight `open()` is stored as a promise and every caller awaits that
one. The promise is cleared on both settle paths, so a failed open does not
poison the object: the next read tries again.

## `close()`, and closing during an open

`close()` releases the descriptor and returns. Reading afterwards reopens, so it
stays a hint that the caller is done rather than a teardown that invalidates the
object — which also means a consumer that closes too eagerly loses a little
speed and nothing else.

The subtle case is `close()` arriving while an `open()` is still in flight.
Dropping the field is not enough: the open would settle afterwards and install
its descriptor into an object nobody will ever call again, leaving it held for
the life of the process. So the drop **waits out the pending open** and closes
whatever it produced.

Failures during the close are swallowed. `EBADF` from a network filesystem means
the descriptor is already gone, and it is being discarded either way; there is
nothing a caller could do with that error.

## What is not handled

- **No open-descriptor budget across instances.** Each `LocalFile` bounds its
  own retention; a thousand simultaneously-active files hold a thousand
  descriptors between them. If that is your shape, lower `fdIdleTimeoutMs` or
  set `cacheFd: false`.
- **No signal support on the read itself.** Node's `fs` cannot cancel a read in
  flight, so the abort check happens either side of it
  ([api.md](api.md#signal)).
- **`readFile()` and `stat()` do not use the held descriptor.** They call
  `readFile`/`stat` by path, which is one syscall's worth of path resolution on
  a call that reads the entire file or nothing at all.
