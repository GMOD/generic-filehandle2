export type Fetcher = (
  input: RequestInfo,
  init?: RequestInit,
) => Promise<Response>

export type RequestOverrides = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
}

export interface FilehandleOptions {
  /**
   * optional AbortSignal object for aborting the request
   */
  signal?: AbortSignal
  headers?: Record<string, string>
  overrides?: RequestOverrides
  encoding?: BufferEncoding
  /**
   * fetch function to use for HTTP requests. defaults to environment's
   * global fetch. if there is no global fetch, and a fetch function is not provided,
   * throws an error.
   */
  fetch?: Fetcher
}

export interface Stats {
  size: number
}

export interface GenericFilehandle {
  read(
    length: number,
    position: number,
    opts?: FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer>>

  readFile(): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: BufferEncoding): Promise<string>
  readFile<T extends undefined>(
    options:
      | Omit<FilehandleOptions, 'encoding'>
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: T }),
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): Promise<string>
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): T extends BufferEncoding
    ? Promise<string>
    : Promise<Uint8Array<ArrayBuffer>>
  stat(): Promise<Stats>
  close(): Promise<void>
}
