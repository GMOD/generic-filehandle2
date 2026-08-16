import { open, readFile, stat } from 'fs/promises'

import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
  ReadFileOptions,
  ReadFileTextOptions,
  Stats,
} from './filehandle.ts'
import type { FileHandle } from 'fs/promises'

export interface LocalFileOptions {
  /**
   * Keep the file descriptor open between reads instead of opening and closing
   * one per read. Default true.
   *
   * Worth ~1.9x on small reads (47 -> 25 us on 64KB reads of a warm file), which
   * matters because an indexed reader issues a lot of them: a single BAM query
   * is 6-20 reads plus the index.
   *
   * The hazard a held descriptor introduces is that it can go stale under you —
   * EBADF on a Samba mount, ESTALE on NFS — where open-per-read cannot. That is
   * handled rather than avoided: a failed read drops the descriptor, reopens,
   * and retries once, so a stale one costs a reopen instead of an error. A file
   * that is genuinely gone fails on the second attempt with its real error.
   *
   * Set false to go back to open-per-read.
   */
  cacheFd?: boolean
  /**
   * Close a held descriptor once nothing has read from it for this many
   * milliseconds. Default 30s; `0` holds it until {@link LocalFile.close}.
   *
   * Without this, one descriptor is retained per instance for the life of the
   * object, and consumers do not reliably close filehandles — JBrowse opens one
   * per track file and never does. Two reasons that matters. Descriptors are a
   * per-process limit, so "one per file object, forever" is a slow leak in a
   * long session; and node deprecated closing a `FileHandle` by garbage
   * collection (DEP0137) and intends to make it an error, so a held descriptor
   * that is only ever collected is a future crash rather than a tidy-up.
   *
   * Releasing on idle keeps the win — reads during a query are milliseconds
   * apart and never see it — while making retention self-limiting for a caller
   * that forgets. The timer is `unref`'d, so it never keeps a process alive.
   */
  fdIdleTimeoutMs?: number
}

/**
 * `unref` the idle timer where the runtime has one.
 *
 * Duck-typed rather than asserted, because this module runs somewhere the two
 * halves of its environment disagree. `setTimeout` returns a `Timeout` under
 * node and a **number** in a DOM context, and a number has no `unref` — but
 * that is not the browser build's problem, since `browser.ts` swaps this whole
 * class for a stub that never opens a descriptor.
 *
 * The case that bites is Electron's renderer, and anything else that resolves
 * the node entry while keeping DOM timers: `fs/promises` is real, so `LocalFile`
 * is the right class and every read works — and then `touch()` reaches for
 * `unref` on a number and throws `this.idleTimer.unref is not a function` out of
 * the read. In JBrowse Desktop that surfaced as a text search adapter failing
 * with no indication that a timer was involved.
 *
 * Missing `unref` costs only what it says: the timer can hold a process alive
 * for `fdIdleTimeoutMs`. In a renderer there is no process to hold open.
 *
 * A type predicate rather than a `typeof` test at the call site: the latter
 * leaves the member typed as a bare `Function`, which `no-unsafe-call` rejects
 * because a bare `Function` says nothing about its parameters or return.
 * Stating the shape here is what makes the call checked, and the body is still
 * an ordinary runtime test — no cast.
 */
function isUnrefable(timer: unknown): timer is { unref: () => void } {
  return (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  )
}

export default class LocalFile implements GenericFilehandle {
  private filename: string
  private cacheFd: boolean
  private fdIdleTimeoutMs: number
  private fh: FileHandle | undefined
  private opening: Promise<FileHandle> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  public constructor(source: string, opts: LocalFileOptions = {}) {
    this.filename = source
    this.cacheFd = opts.cacheFd ?? true
    this.fdIdleTimeoutMs = opts.fdIdleTimeoutMs ?? 30_000
  }

  /**
   * Restart the idle countdown. Called after every read, so the clock measures
   * time since the last read rather than time since the descriptor opened.
   */
  private touch() {
    if (this.fdIdleTimeoutMs <= 0) {
      return
    }
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      void this.dropHandle()
    }, this.fdIdleTimeoutMs)
    // never hold a node process open just to close a descriptor later
    if (isUnrefable(this.idleTimer)) {
      this.idleTimer.unref()
    }
  }

  /**
   * The open descriptor, opening one if needed. Concurrent callers share a
   * single `open()` — an indexed reader routinely fires six reads at once and
   * they should not race to open six descriptors.
   */
  private async handle() {
    if (this.fh) {
      return this.fh
    }
    this.opening ??= open(this.filename, 'r').then(
      fh => {
        this.fh = fh
        this.opening = undefined
        return fh
      },
      (e: unknown) => {
        this.opening = undefined
        throw e
      },
    )
    return this.opening
  }

  private async dropHandle() {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    // wait out an open still in flight, or it installs its descriptor after we
    // have finished dropping and close() returns leaving one held
    const fh = this.fh ?? (await this.opening?.catch(() => undefined))
    this.fh = undefined
    if (fh) {
      try {
        await fh.close()
      } catch {
        // Already closed or invalid. This is the EBADF that network
        // filesystems produce, and there is nothing to do about it here: the
        // descriptor is being discarded either way.
      }
    }
  }

  public async read(
    length: number,
    position = 0,
    opts: FilehandleOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (length === 0) {
      return new Uint8Array(0)
    }
    opts.signal?.throwIfAborted()
    if (!this.cacheFd) {
      return this.readWithOwnHandle(length, position, opts)
    }
    // Two attempts: a descriptor held across reads can be invalidated out from
    // under us (see LocalFileOptions.cacheFd), and reopening is the recovery.
    for (let attempt = 0; ; attempt++) {
      const fh = await this.handle()
      try {
        const bytes = await this.readFrom(fh, length, position, opts)
        this.touch()
        return bytes
      } catch (e) {
        await this.dropHandle()
        // A cancelled read is not a sick descriptor. Retrying one would reopen
        // the file and redo the read purely to abort again on the second pass.
        if (attempt > 0 || opts.signal?.aborted) {
          throw e
        }
      }
    }
  }

  private async readFrom(
    fh: FileHandle,
    length: number,
    position: number,
    opts: FilehandleOptions,
  ) {
    const arr = new Uint8Array(length)
    const res = await fh.read(arr, 0, length, position)
    // node's fs has no signal support on read, so the read runs to completion
    // regardless; checking here at least stops the bytes being handed to a
    // caller that has given up, and matches what RemoteFile does.
    opts.signal?.throwIfAborted()
    return res.buffer.subarray(0, res.bytesRead)
  }

  private async readWithOwnHandle(
    length: number,
    position: number,
    opts: FilehandleOptions,
  ) {
    let fd
    try {
      fd = await open(this.filename, 'r')
      return await this.readFrom(fd, length, position, opts)
    } finally {
      if (fd) {
        try {
          await fd.close()
        } catch {
          // Ignore EBADF errors - the file descriptor is already closed/invalid
          // This can happen on network filesystems like Samba
        }
      }
    }
  }

  public async readFile(
    options?: ReadFileOptions,
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(options: ReadFileTextOptions): Promise<string>
  public async readFile(
    options?: FilehandleOptions | BufferEncoding,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    return readFile(this.filename, options)
  }

  public async stat(): Promise<Stats> {
    return stat(this.filename)
  }

  /**
   * Release the held descriptor, if there is one. Reading again reopens, so
   * this is safe to call at any point — it is a hint that the caller is done,
   * not a teardown that invalidates the object.
   */
  public async close(): Promise<void> {
    await this.dropHandle()
  }
}
