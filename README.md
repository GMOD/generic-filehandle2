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

If you are reading a remote file through an indexed parser, put
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle)
underneath it. Its `RemoteFileWithRangeCache` is a drop-in replacement for
`RemoteFile` that caches byte ranges in chunks, so that a query's many small
reads turn into a few requests.

## API

Every filehandle has the same four methods:

```js
await file.read(length, position, opts) // the bytes at a byte offset
await file.readFile(opts) // the whole file, as bytes or as a string
await file.stat() // the file size, as { size }
await file.close() // close the file descriptor, if one is open
```

[docs/api.md](docs/api.md) covers their options, shared behavior, and how to
extend `RemoteFile`.

`LocalFile`'s constructor also takes `cacheFd` and `fdIdleTimeoutMs`, which
control its file descriptor; see [docs/local-files.md](docs/local-files.md).

## Docs

- [docs/api.md](docs/api.md): every method, option and type
- [docs/optimizations.md](docs/optimizations.md): why reads, requests and
  buffers work the way they do, with measurements
- [docs/local-files.md](docs/local-files.md): `LocalFile`'s open descriptor, and
  its browser stub

## See also

The original generic-filehandle library:
https://github.com/GMOD/generic-filehandle

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub
Actions.

```bash
pnpm version patch  # or minor/major
```
