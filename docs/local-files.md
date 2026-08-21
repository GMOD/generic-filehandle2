# Local files and the descriptor

`LocalFile` holds one file descriptor open across reads and closes it once
nothing has read from it for 30 seconds. This is why each half is the default.
None of it applies in a browser build, where `LocalFile` is a stub that rejects
every call ([browser-builds.md](browser-builds.md)).

## Why hold a descriptor at all

The original implementation opened and closed one per read. For a reader that
streams a whole file that costs nothing measurable; for an **indexed** reader it
is most of the read, since a single BAM query is 6-20 reads of a few tens of
kilobytes each, plus the index reads in front of them.

Two runs on the same machine, 64KB reads of a warm file, arms interleaved:

| open-per-read | held descriptor | ratio |
| ------------- | --------------- | ----- |
| 138 µs        | 65 µs           | 2.1x  |
| 47 µs         | 25 µs           | 1.9x  |

Absolutes move with the machine, filesystem and node version — the two rows
differ by ~3x on the same code — so take the ratio, roughly **1.9-2.1x**, and
re-measure rather than quoting these. Every node consumer is affected: CLI
tools, indexing jobs, every sibling repo's test suite. `cacheFd: false` restores
open-per-read exactly.

## The hazard, and why it is handled rather than avoided

A descriptor held across reads can be invalidated underneath you: `EBADF` on a
Samba mount, `ESTALE` on NFS, a stale inode where a writer replaced the file.
Open-per-read cannot hit this, which is presumably why the original code did it.

Avoiding the hazard costs 2x on every read of every user. Handling it costs a
reopen on the rare read that trips it: a failed read **drops the descriptor,
reopens, and retries once**, and the second attempt throws whatever it throws
with its real errno intact, so a genuinely missing file still fails `ENOENT`
rather than looping. An **aborted** read is never retried — a cancellation is
not a sick descriptor, and retrying one would spend a reopen and a second read
on its way to throwing anyway.

`test/localFileFd.test.ts` injects the fault directly — reaching into the
private field to close the descriptor out from under the object, since a local
disk will not produce it — and kills it five times running to prove the retry
does not degrade into a loop.

## The idle timeout

Holding a descriptor for the life of the object is the obvious next step, and it
is wrong for two reasons that have nothing to do with performance.

**Consumers do not close filehandles.** JBrowse opens one per track file and
never calls `close()`; that is not unusual, because the interface reads like a
value rather than a resource. **And a descriptor never closed is not free** —
they are a per-process limit, so one per file object forever is a slow leak in a
long session, and node has deprecated closing a `FileHandle` by garbage
collection (DEP0137) with the intent to make it an error, which makes a
collected-only descriptor a future crash rather than a tidy-up.

So retention is bounded by time instead of by trust. The idle timer restarts
after every successful read, so the clock measures **time since the last read**:
reads inside a query are milliseconds apart and never see it, while a file
nobody has touched for 30 seconds gives its descriptor back. That keeps the 2x
where it matters and makes a forgetful caller safe, which is the combination
neither "open per read" nor "hold forever" offers.

```js
new LocalFile(path) // 30s idle timeout
new LocalFile(path, { fdIdleTimeoutMs: 0 }) // hold until close()
new LocalFile(path, { fdIdleTimeoutMs: 5000 }) // shorter leash
new LocalFile(path, { cacheFd: false }) // no descriptor held at all
```

The timer is `unref`'d, so a pending close never holds a node process alive.

### `unref` is not always there

`setTimeout` returns a `Timeout` under node and an opaque **number** in a DOM
context, and a number has no `unref`. Reaching for it throws
`this.idleTimer.unref is not a function` — out of the read, with nothing in the
message or the stack naming a timer.

The browser build is not where this bites, since it swaps the class for a stub.
The case that bites is **Electron's renderer**, and anything else resolving the
node entry while keeping DOM timers: `fs/promises` is real, so `LocalFile` is
the correct class and every read works right up until the timer. In JBrowse
Desktop it surfaced as a text search adapter failing for no visible reason.

The call is therefore guarded by a duck-typed predicate, and the guard is cheap
to be wrong about: a missing `unref` costs only the timer's ability to hold a
process open for `fdIdleTimeoutMs`, and a renderer has no process to hold. The
test replaces `globalThis.setTimeout` with the DOM signature and reads through
it.

It is a type guard rather than a `typeof` check at the call site, because that
leaves the member typed as a bare `Function` — saying nothing about parameters
or return, so `no-unsafe-call` rejects calling it. Stating the shape is what
makes the call checked, with no cast anywhere.

## Concurrent reads, and closing

An indexed reader fires reads without awaiting between them — six at once is
ordinary — and each finding no descriptor and opening its own would mean six
opens, five discarded. So an in-flight `open()` is stored as a promise every
caller awaits, cleared on both settle paths so a failed open does not poison the
object.

`close()` releases the descriptor and returns; reading afterwards reopens, so it
stays a hint rather than a teardown, and a consumer that closes too eagerly
loses a little speed and nothing else. The subtle case is `close()` arriving
while an `open()` is in flight: dropping the field is not enough, because the
open would settle afterwards and install a descriptor into an object nobody will
call again, held for the life of the process. So the drop **waits out the
pending open** and closes whatever it produced. Failures during the close are
swallowed — `EBADF` from a network filesystem means the descriptor is already
gone, and it is being discarded either way.

## What is not handled

- **No descriptor budget across instances.** Each `LocalFile` bounds its own
  retention; a thousand simultaneously-active files hold a thousand descriptors
  between them. If that is your shape, lower `fdIdleTimeoutMs` or set
  `cacheFd: false`.
- **No signal support on the read itself**, because node's `fs` has none
  ([api.md](api.md#options)).
- **`readFile()` and `stat()` do not use the held descriptor.** They go by path,
  which is one path resolution on a call that reads the entire file or nothing.
