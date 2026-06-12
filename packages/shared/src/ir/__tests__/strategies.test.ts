import { describe, expect, it } from 'vitest'
import { appendixLetterOf, gbT11Strategy } from '../strategies'

describe('gbT11Strategy', () => {
  it('章与条编号', () => {
    expect(gbT11Strategy.chapter(5)).toBe('5')
    expect(gbT11Strategy.clause([5, 1, 2])).toBe('5.1.2')
  })

  it('附录字母与标签', () => {
    expect(gbT11Strategy.appendixLetter(1)).toBe('A')
    expect(gbT11Strategy.appendixLetter(26)).toBe('Z')
    expect(appendixLetterOf(27)).toBe('AA')
    expect(gbT11Strategy.appendix(2)).toBe('附录B')
  })

  it('图/表编号：正文与附录前缀', () => {
    expect(gbT11Strategy.figure(3)).toBe('图3')
    expect(gbT11Strategy.figure(1, 'A')).toBe('图A.1')
    expect(gbT11Strategy.table(2)).toBe('表2')
    expect(gbT11Strategy.table(4, 'B')).toBe('表B.4')
  })

  it('公式编号带括号', () => {
    expect(gbT11Strategy.formula(1)).toBe('(1)')
    expect(gbT11Strategy.formula(2, 'A')).toBe('(A.2)')
  })

  it('注/示例：单条不编号，多条编号', () => {
    expect(gbT11Strategy.note(1, 1)).toBe('注：')
    expect(gbT11Strategy.note(2, 3)).toBe('注2：')
    expect(gbT11Strategy.example(1, 1)).toBe('示例：')
    expect(gbT11Strategy.example(1, 2)).toBe('示例1：')
  })

  it('参考文献编号', () => {
    expect(gbT11Strategy.bibEntry(3)).toBe('[3]')
  })
})
