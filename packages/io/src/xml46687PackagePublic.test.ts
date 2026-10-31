import { expect, it } from 'vitest'
import * as io from './index'

it('资源包导入入口从公共 io 包导出', () => {
  expect(io.importXml46687Package).toBeTypeOf('function')
})
