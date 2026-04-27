# generic-filehandle2

[![NPM version](https://img.shields.io/npm/v/generic-filehandle2.svg?style=flat-square)](https://npmjs.org/package/generic-filehandle2)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/generic-filehandle2/push.yml?branch=main)](https://github.com/GMOD/generic-filehandle2/actions)

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

Returns an object with the `size` of the file.

### Options

All entries are optional.

- `signal` `<AbortSignal>` - passed to the fetch or file read call
- `headers` `<Record<string, string>>` - extra HTTP headers for remote requests
- `overrides` `<Object>` - extra parameters passed to the fetch call
- `encoding` `<string>` - (`readFile` only) if set to `"utf8"`, returns a string instead of `Uint8Array`

### Constructor options

The `RemoteFile` constructor accepts the same Options above, plus:

- `fetch` `<Function>` - custom fetch implementation (defaults to `globalThis.fetch`)

## See also

The original generic-filehandle library: https://github.com/GMOD/generic-filehandle
