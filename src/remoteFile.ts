import { toBytes } from './util.ts'

import type {
  BufferEncoding,
  Fetcher,
  FilehandleOptions,
  GenericFilehandle,
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
  private fetchImplementation: Fetcher
  private baseHeaders: Record<string, string>
  private baseOverrides: Omit<RequestInit, 'headers'>
  private warnedGzipEncoding = false

  public constructor(source: string, opts: FilehandleOptions = {}) {
    this.url = source
    this.baseHeaders = opts.headers ?? {}
    this.baseOverrides = opts.overrides ?? {}
    this.fetchImplementation = opts.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private buildRequest(
    opts: FilehandleOptions,
    extraHeaders?: Record<string, string>,
  ): RequestInit {
    return {
      ...this.baseOverrides,
      ...opts.overrides,
      headers: { ...this.baseHeaders, ...opts.headers, ...extraHeaders },
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
      signal: opts.signal,
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
    const res = await this.fetch(
      this.url,
      this.buildRequest(opts, {
        range: `bytes=${position}-${position + length - 1}`,
      }),
    )

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${this.url}`)
    }

    // content-encoding is not a CORS-safelisted header, so under cross-origin
    // requests it returns null unless the server explicitly exposes it via
    // Access-Control-Expose-Headers. The warn will fire when visible but is
    // silently skipped under typical CORS — never throws.
    if (
      !this.warnedGzipEncoding &&
      res.headers.get('content-encoding') === 'gzip'
    ) {
      this.warnedGzipEncoding = true
      console.warn(
        `${this.url}: range request response has content-encoding: gzip — byte offsets will be wrong`,
      )
    }

    if ((res.status === 200 && position === 0) || res.status === 206) {
      // try to parse out the size of the remote file
      const contentRange = res.headers.get('content-range')
      const sizeMatch = /\/(\d+)$/.exec(contentRange ?? '')
      if (sizeMatch?.[1]) {
        this._stat = {
          size: parseInt(sizeMatch[1], 10),
        }
      }

      const resData = await toBytes(res)
      // server didn't honor the range request and returned the full file —
      // the body length is the actual file size
      if (!this._stat && res.status === 200) {
        this._stat = { size: resData.byteLength }
      }
      return resData.byteLength <= length
        ? resData
        : resData.subarray(0, length)
    }

    throw new Error(
      res.status === 200
        ? `${this.url} fetch returned status 200, expected 206`
        : `HTTP ${res.status} fetching ${this.url}`,
    )
  }

  public async readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  public async readFile(
    options: FilehandleOptions | BufferEncoding = {},
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    const encoding = typeof options === 'string' ? options : options.encoding
    const opts = typeof options === 'string' ? {} : options
    const res = await this.fetch(this.url, this.buildRequest(opts))
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${this.url}`)
    }
    if (encoding === 'utf8') {
      return res.text()
    } else if (encoding) {
      throw new Error(`unsupported encoding: ${encoding}`)
    } else {
      return toBytes(res)
    }
  }

  public async stat(): Promise<Stats> {
    if (!this._stat) {
      await this.read(10, 0)
    }
    // Content-Range may not be exposed due to CORS — return size 0 rather
    // than crashing so callers can degrade gracefully.
    return this._stat ?? { size: 0 }
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}
