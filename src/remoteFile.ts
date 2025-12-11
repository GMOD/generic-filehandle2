import type {
  Fetcher,
  FilehandleOptions,
  GenericFilehandle,
  Stats,
} from './filehandle.ts'

function getMessage(e: unknown) {
  const r =
    typeof e === 'object' && e !== null && 'message' in e
      ? (e.message as string)
      : `${e}`
  return r.replace(/\.$/, '')
}

export default class RemoteFile implements GenericFilehandle {
  protected url: string
  private _stat?: Stats
  private fetchImplementation: Fetcher
  private baseOverrides: any = {}

  public constructor(source: string, opts: FilehandleOptions = {}) {
    this.url = source
    const fetch = opts.fetch || globalThis.fetch.bind(globalThis)
    if (opts.overrides) {
      this.baseOverrides = opts.overrides
    }
    this.fetchImplementation = fetch
  }

  public async fetch(
    input: RequestInfo,
    init: RequestInit | undefined,
  ): Promise<Response> {
    let response
    try {
      response = await this.fetchImplementation(input, init)
    } catch (e) {
      if (`${e}`.includes('Failed to fetch')) {
        // refetch to to help work around a chrome bug (discussed in
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
          throw new Error(`${getMessage(e)} fetching ${input}`, { cause: e })
        }
      } else {
        throw new Error(`${getMessage(e)} fetching ${input}`, { cause: e })
      }
    }
    return response
  }

  public async read(
    length: number,
    position: number,
    opts: FilehandleOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    const { headers = {}, signal, overrides = {} } = opts
    if (length < Infinity) {
      headers.range = `bytes=${position}-${position + length - 1}`
    } else if (length === Infinity && position !== 0) {
      headers.range = `bytes=${position}-`
    }
    const res = await this.fetch(this.url, {
      ...this.baseOverrides,
      ...overrides,
      headers: {
        ...this.baseOverrides.headers,
        ...overrides.headers,
        ...headers,
      },
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
      signal,
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${this.url}`)
    }

    if ((res.status === 200 && position === 0) || res.status === 206) {
      const resData = await res.arrayBuffer()

      // try to parse out the size of the remote file
      const contentRange = res.headers.get('content-range')
      const sizeMatch = /\/(\d+)$/.exec(contentRange || '')
      if (sizeMatch?.[1]) {
        this._stat = {
          size: parseInt(sizeMatch[1], 10),
        }
      }

      return resData.byteLength <= length
        ? new Uint8Array(resData)
        : new Uint8Array(resData.slice(0, length))
    }

    throw new Error(
      res.status === 200
        ? `${this.url} fetch returned status 200, expected 206`
        : `HTTP ${res.status} fetching ${this.url}`,
    )
  }

  public async readFile(): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(options: BufferEncoding): Promise<string>
  public async readFile<T extends undefined>(
    options:
      | Omit<FilehandleOptions, 'encoding'>
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: T }),
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): Promise<string>
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): T extends BufferEncoding
    ? Promise<Uint8Array<ArrayBuffer>>
    : Promise<Uint8Array<ArrayBuffer> | string>
  public async readFile(
    options: FilehandleOptions | BufferEncoding = {},
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    let encoding
    let opts
    if (typeof options === 'string') {
      encoding = options
      opts = {}
    } else {
      encoding = options.encoding
      const { encoding: _, ...rest } = options
      opts = rest
    }
    const { headers = {}, signal, overrides = {} } = opts
    const res = await this.fetch(this.url, {
      ...this.baseOverrides,
      ...overrides,
      headers: {
        ...this.baseOverrides.headers,
        ...overrides.headers,
        ...headers,
      },
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
      signal,
    })
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} fetching ${this.url}`)
    }
    if (encoding === 'utf8') {
      return res.text()
    } else if (encoding) {
      throw new Error(`unsupported encoding: ${encoding}`)
    } else {
      return new Uint8Array(await res.arrayBuffer())
    }
  }

  public async stat(): Promise<Stats> {
    if (!this._stat) {
      await this.read(10, 0)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!this._stat) {
        throw new Error(`unable to determine size of file at ${this.url}`)
      }
    }
    return this._stat
  }

  public async close(): Promise<void> {
    return
  }
}
