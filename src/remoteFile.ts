import {
  parseContentRangeSize,
  splitReadFileOptions,
  toBytes,
  toBytesWithProgress,
} from './util.ts'

import type {
  BufferEncoding,
  Fetcher,
  FilehandleOptions,
  GenericFilehandle,
  ReadFileOptions,
  ReadFileTextOptions,
  Stats,
} from './filehandle.ts'

function getMessage(e: unknown) {
  const r =
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof e.message === 'string'
      ? e.message
      : `${e}`
  // strip trailing period so the wrapped form `${msg} fetching ${url}` reads cleanly
  return r.replace(/\.$/, '')
}

export default class RemoteFile implements GenericFilehandle {
  protected url: string
  private _stat?: Stats
  private statProbe?: Promise<unknown>
  private fetchImplementation: Fetcher
  private baseHeaders: Record<string, string>
  private baseOverrides: Omit<RequestInit, 'headers'>
  private baseSignal?: AbortSignal

  public constructor(source: string, opts: FilehandleOptions = {}) {
    this.url = source
    this.baseHeaders = opts.headers ?? {}
    this.baseOverrides = opts.overrides ?? {}
    this.baseSignal = opts.signal
    this.fetchImplementation = opts.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private buildRequest(
    opts: FilehandleOptions,
    extraHeaders?: Record<string, string>,
  ): RequestInit {
    // a per-call signal beats the constructor's, which beats one supplied via
    // overrides; omit the key entirely when there is none, so we don't write
    // `signal: undefined` over an overrides-supplied signal
    const signal = opts.signal ?? this.baseSignal
    return {
      // defaults first: `overrides` is documented as extra fetch params, so a
      // caller passing e.g. mode/redirect/method has to be able to win
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
      ...this.baseOverrides,
      ...opts.overrides,
      headers: { ...this.baseHeaders, ...opts.headers, ...extraHeaders },
      ...(signal ? { signal } : {}),
    }
  }

  public async fetch(
    input: RequestInfo,
    init: RequestInit | undefined,
  ): Promise<Response> {
    const wrapError = (e: unknown) =>
      new Error(`${getMessage(e)} fetching ${input}`, { cause: e })

    let response: Response
    try {
      response = await this.fetchImplementation(input, init)
    } catch (e) {
      if (`${e}`.includes('Failed to fetch')) {
        // refetch to help work around a chrome bug (discussed in
        // generic-filehandle issue #72) in which the chrome cache returns a
        // CORS error for content in its cache.  see also
        // https://github.com/GMOD/jbrowse-components/pull/1511
        console.warn(
          `generic-filehandle: refetching ${input} to attempt to work around chrome CORS header caching bug`,
        )
        try {
          response = await this.fetchImplementation(input, {
            ...init,
            cache: 'reload',
          })
        } catch (e) {
          throw wrapError(e)
        }
      } else {
        throw wrapError(e)
      }
    }
    return response
  }

  public async read(
    length: number,
    position: number,
    opts: FilehandleOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (length === 0) {
      return new Uint8Array(0)
    }
    if (Number.isNaN(length) || Number.isNaN(position)) {
      throw new TypeError(
        `read() called with NaN length or position (length=${length}, position=${position}). The index file may be corrupt.`,
      )
    }
    return this.fetchBytes(length, position, opts)
  }

  /**
   * The bytes for one byte range — the seam a subclass that can serve those
   * bytes some other way overrides.
   *
   * The alternative is overriding {@link fetch}, and for a subclass holding a
   * byte cache that is the wrong altitude: it has bytes, so it has to wrap them
   * in a `Response` that `read` immediately unwraps again. Both halves copy.
   * Measured against JBrowse's `RemoteFileWithRangeCache` on a fully warm cache
   * with no network at all, that round trip was **69-77% of the entire read** —
   * 6.15ms vs 1.90ms for 16MB, and the same ratio down to 256KB.
   *
   * So: override this to serve bytes, override {@link fetch} to change how
   * requests are made. Overriding neither leaves the ranged GET below, and the
   * default implementation still goes through `this.fetch`, so a subclass that
   * only wraps `fetch` keeps working untouched.
   */
  protected async fetchBytes(
    length: number,
    position: number,
    opts: FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const res = await this.fetch(
      this.url,
      this.buildRequest(opts, {
        range: `bytes=${position}-${position + length - 1}`,
      }),
    )

    // HTTP 416 Range Not Satisfiable: the requested range starts past EOF.
    // Translate to an empty read so callers can detect EOF via short/empty
    // returns instead of needing a separate size oracle (stat) to stay clear of
    // the end of the file.
    if (res.status === 416) {
      return new Uint8Array(0)
    }

    this.checkOk(res)

    if ((res.status === 200 && position === 0) || res.status === 206) {
      // try to parse out the size of the remote file
      const size = parseContentRangeSize(res.headers.get('content-range'))
      if (size !== undefined) {
        this._stat = { size }
      }

      const resData = opts.onProgress
        ? await toBytesWithProgress(res, opts.onProgress)
        : await toBytes(res)
      // server didn't honor the range request and returned the full file —
      // the body length is the actual file size
      if (!this._stat && res.status === 200) {
        this._stat = { size: resData.byteLength }
      }
      // the server over-delivered (it ignored our range header and sent the
      // whole file). copy out the requested slice rather than returning a
      // subarray view, which would pin the entire body in memory for as long
      // as the caller holds those few bytes.
      return resData.byteLength <= length ? resData : resData.slice(0, length)
    }

    throw new Error(
      res.status === 200
        ? `${this.url} fetch returned status 200, expected 206`
        : `HTTP ${res.status} fetching ${this.url}`,
    )
  }

  private checkOk(res: Response) {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${this.url}`)
    }
  }

  public async readFile(
    options?: ReadFileOptions,
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(options: ReadFileTextOptions): Promise<string>
  public async readFile(
    options?: FilehandleOptions | BufferEncoding,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    const { encoding, opts } = splitReadFileOptions(options)
    const res = await this.fetch(this.url, this.buildRequest(opts))
    this.checkOk(res)
    if (encoding === 'utf8') {
      return res.text()
    } else if (encoding) {
      throw new Error(`unsupported encoding: ${encoding}`)
    }
    const bytes = opts.onProgress
      ? await toBytesWithProgress(res, opts.onProgress)
      : await toBytes(res)
    // a 200 means we hold the entire file, so its length is the file size —
    // record it so a subsequent stat() doesn't need another request. a 206
    // (caller supplied their own range header) tells us nothing.
    if (res.status === 200) {
      this._stat = { size: bytes.byteLength }
    }
    return bytes
  }

  public async stat(): Promise<Stats> {
    if (!this._stat) {
      // share one probe between concurrent stat() callers instead of each
      // firing its own request; cleared afterwards so a failed probe retries
      this.statProbe ??= this.read(10, 0).finally(() => {
        this.statProbe = undefined
      })
      await this.statProbe
    }
    // Content-Range may not be exposed due to CORS — return size 0 rather
    // than crashing so callers can degrade gracefully.
    return this._stat ?? { size: 0 }
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}
