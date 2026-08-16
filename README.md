# generic-filehandle2

[![NPM version](https://img.shields.io/npm/v/generic-filehandle2.svg?style=flat-square)](https://npmjs.org/package/generic-filehandle2)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/generic-filehandle2/publish.yml?branch=main)

Provides a uniform interface for accessing binary data from local files, remote
HTTP resources, and Blob data in the browser.

## Usage

```js
import { LocalFile, RemoteFile, BlobFile } from 'generic-filehandle2'

const local = new LocalFile('/some/file/path/file.txt')
const remote = new RemoteFile('http://somesite.com/file.txt')
const blobfile = new BlobFile(new Blob([some_data], { type: 'text/plain' }))

const buf1 = await remote.read(/* length */ 10, /* position */ 10) // range request
const buf2 = await remote.readFile()
```

## API

### `async read(length: number, position: number, opts?: Options): Promise<Uint8Array>`

- `length` - number of bytes to read
- `position` - byte offset to read from

### `async readFile(opts?: Options): Promise<Uint8Array | string>`

Returns the full file contents as a `Uint8Array`, or as a `string` if
`opts.encoding` is set.

### `async stat(): Promise<{ size: number }>`

Returns an object with the `size` of the file. `RemoteFile` learns the size from
a `Content-Range` header, so the first `stat()` costs a small range request, and
a server that does not expose that header through CORS yields `{ size: 0 }`.

### `async close(): Promise<void>`

Releases what the handle holds — for `LocalFile`, its file descriptor. Reading
again reopens, so this is a hint that the caller is done rather than a teardown.

### Options

All entries are optional.

- `signal` `<AbortSignal>` - passed to the fetch or file read call
- `headers` `<Record<string, string>>` - extra HTTP headers for remote requests
- `overrides` `<Object>` - extra parameters passed to the fetch call. These take
  precedence over the defaults this library sets (`method`, `redirect`, `mode`)
- `encoding` `<string>` - (`readFile` only) if set to `"utf8"` (or `"utf-8"`),
  returns a string instead of `Uint8Array`. `LocalFile` takes any encoding
  node's `readFile` does; the other two handle utf8 only
- `onProgress` `<(bytesReceived: number, total?: number) => void>` - opt-in
  download progress for remote reads. Setting it streams the response body;
  omitting it keeps the faster non-streaming path

### Constructor options

The `RemoteFile` constructor accepts the same Options above, plus:

- `fetch` `<Function>` - custom fetch implementation (defaults to
  `globalThis.fetch`)

The `LocalFile` constructor accepts:

- `cacheFd` `<boolean>` - keep one file descriptor open across reads instead of
  opening one per read. Default `true`, and worth ~1.9x on the small reads an
  indexed reader issues. A descriptor that goes stale (NFS, Samba) costs a
  reopen rather than an error
- `fdIdleTimeoutMs` `<number>` - close a held descriptor once nothing has read
  from it for this long. Default 30000; `0` holds it until `close()`

### Serving bytes from a subclass

`RemoteFile`'s `protected fetchBytes(length, position, opts)` is the seam for a
subclass that already has the bytes — a range cache, say. Overriding it skips
wrapping them in a `Response` for `read()` to immediately unwrap, which measured
as most of the cost of a warm cache hit. Override `fetch` instead to change how
requests are made; a subclass that only wraps `fetch` keeps working untouched.

## See also

The original generic-filehandle library:
https://github.com/GMOD/generic-filehandle

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub
Actions.

```bash
pnpm version patch  # or minor/major
```
