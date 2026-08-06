import { expect, test } from 'vitest'

import { testLocalFile, toString } from './helpers.ts'

test('reads file', async () => {
  const b = await testLocalFile().readFile()
  expect(toString(b)).toEqual('testing\n')
})
test('reads file with encoding', async () => {
  const f = testLocalFile()
  expect(await f.readFile('utf8')).toEqual('testing\n')
  expect(await f.readFile({ encoding: 'utf8' })).toEqual('testing\n')
})
test('reads local file', async () => {
  const buf = await testLocalFile().read(3, 0)
  expect(toString(buf)).toEqual('tes')
})
test('zero read', async () => {
  const buf = await testLocalFile().read(0, 0)
  expect(toString(buf)).toEqual('')
})
test('reads local file clipped at the end', async () => {
  const buf = await testLocalFile().read(3, 6)
  expect(toString(buf).replace('\0', '')).toEqual('g\n')
})
test('get stat', async () => {
  const ret = await testLocalFile().stat()
  expect(ret.size).toEqual(8)
})
