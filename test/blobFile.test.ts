import { expect, test } from 'vitest'

import { testBlobFile, toString } from './helpers.ts'

test('reads whole file', async () => {
  const fileContents = await testBlobFile().readFile()
  expect(toString(fileContents)).toEqual('testing\n')
})
test('reads whole file with encoding', async () => {
  const blobFile = testBlobFile()
  expect(await blobFile.readFile('utf8')).toEqual('testing\n')
  expect(await blobFile.readFile({ encoding: 'utf8' })).toEqual('testing\n')
  // @ts-expect-error passing invalid encoding to test runtime error
  await expect(blobFile.readFile('fakeEncoding')).rejects.toThrow(
    /unsupported encoding/,
  )
})
test('reads file part', async () => {
  const buf = await testBlobFile().read(3, 0)
  expect(toString(buf)).toEqual('tes')
})
test('reads zero length file part', async () => {
  const buf = await testBlobFile().read(0, 0)
  expect(toString(buf)).toEqual('')
})
test('reads file part clipped at end', async () => {
  const buf = await testBlobFile().read(3, 6)
  expect(toString(buf)).toEqual('g\n')
})
test('gets stat', async () => {
  const s = await testBlobFile().stat()
  expect(s.size).toEqual(8)
})
