// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  approveExternalImage,
  EXTERNAL_IMAGE_PLACEHOLDER_SRC,
  externalImageHost,
  guardImageAttributes,
  isEmbeddedImageSrc,
  isExternalImageApproved,
  isExternalImageSrc,
  readImageSrc,
  readImageTitle,
  resetApprovedExternalImages,
} from './imageSource'

beforeEach(() => resetApprovedExternalImages())

describe('isEmbeddedImageSrc / isExternalImageSrc', () => {
  it.each([
    'data:image/png;base64,AAAA',
    'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
    'DATA:IMAGE/PNG;base64,AAAA',
    'blob:http://localhost:5173/6f1c2c1e-0000-4000-8000-000000000000',
    'BLOB:null/abc',
  ])('%s 是内嵌图片', (src) => {
    expect(isEmbeddedImageSrc(src)).toBe(true)
    expect(isExternalImageSrc(src)).toBe(false)
  })

  it.each([
    'http://evil.example/a.png',
    'https://evil.example/a.png',
    'HTTPS://EVIL.EXAMPLE/a.png',
    '//evil.example/a.png',
    '/api/files/a.png',
    'a.png',
    '../a.png',
    'file:///etc/hostname',
    'ftp://evil.example/a.png',
    'data:text/html,<script>1</script>',
    ' http://evil.example/a.png',
  ])('%s 是外部图片', (src) => {
    expect(isEmbeddedImageSrc(src)).toBe(false)
    expect(isExternalImageSrc(src)).toBe(true)
  })

  it.each([undefined, null, '', '   '])('%j 既不是内嵌也不是外部（没有可加载的地址）', (src) => {
    expect(isEmbeddedImageSrc(src)).toBe(false)
    expect(isExternalImageSrc(src)).toBe(false)
  })
})

describe('已允许加载的外部图片集合', () => {
  it('approveExternalImage 之后 isExternalImageApproved 为 true，按完整地址精确匹配', () => {
    expect(isExternalImageApproved('https://a.example/x.png')).toBe(false)
    approveExternalImage('https://a.example/x.png')
    expect(isExternalImageApproved('https://a.example/x.png')).toBe(true)
    expect(isExternalImageApproved('https://a.example/y.png')).toBe(false)
    expect(isExternalImageApproved('https://a.example/x.png?')).toBe(false)
  })
})

describe('占位图', () => {
  it('是内嵌 SVG data URL，不含任何外部引用', () => {
    expect(EXTERNAL_IMAGE_PLACEHOLDER_SRC.startsWith('data:image/svg+xml')).toBe(true)
    expect(isEmbeddedImageSrc(EXTERNAL_IMAGE_PLACEHOLDER_SRC)).toBe(true)
    const svg = decodeURIComponent(EXTERNAL_IMAGE_PLACEHOLDER_SRC.split(',')[1]!)
    expect(svg).toContain('外部图片未加载，点击加载')
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:|href|url\(/i)
  })
})

describe('externalImageHost', () => {
  it('绝对地址取主机名，其余给笼统说明', () => {
    expect(externalImageHost('https://img.evil.example:8443/a.png')).toBe('img.evil.example')
    expect(externalImageHost('//cdn.example/a.png')).toBe('cdn.example')
    expect(externalImageHost('http://192.168.1.5/a.png')).toBe('192.168.1.5')
    expect(externalImageHost('/a.png')).toBe('相对路径')
    expect(externalImageHost('a.png')).toBe('相对路径')
    expect(externalImageHost('file:///etc/hostname')).toBe('其他协议')
  })
})

describe('guardImageAttributes', () => {
  it('外部且未允许：src 换成占位图，真实地址放 data-external-src，不输出 srcset，title 改为提示', () => {
    const out = guardImageAttributes({ src: 'https://evil.example/a.png', srcset: 'https://evil.example/a2.png 2x', alt: '图', title: '原标题' })
    expect(out.src).toBe(EXTERNAL_IMAGE_PLACEHOLDER_SRC)
    expect(out['data-external-src']).toBe('https://evil.example/a.png')
    expect(out.srcset).toBeUndefined()
    expect(out.class).toBe('is-external-image')
    expect(out.title).toBe('外部图片未加载，点击加载：evil.example')
    expect(out['data-original-title']).toBe('原标题')
    expect(out.alt).toBe('图')
  })

  it('内嵌、空地址、已允许的外部图片原样返回', () => {
    const embedded = { src: 'data:image/png;base64,AAAA', title: 't' }
    expect(guardImageAttributes(embedded)).toBe(embedded)
    const empty = { src: '' }
    expect(guardImageAttributes(empty)).toBe(empty)
    approveExternalImage('https://ok.example/a.png')
    const approved = { src: 'https://ok.example/a.png' }
    expect(guardImageAttributes(approved)).toBe(approved)
  })
})

describe('readImageSrc / readImageTitle', () => {
  const el = (html: string) => {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.firstElementChild!
  }

  it('占位元素以 data-external-src 为准，不会把占位图当作地址', () => {
    const image = el(`<img src="${EXTERNAL_IMAGE_PLACEHOLDER_SRC}" data-external-src="https://evil.example/a.png" title="外部图片未加载，点击加载：evil.example" data-original-title="原标题">`)
    expect(readImageSrc(image, '')).toBe('https://evil.example/a.png')
    expect(readImageTitle(image)).toBe('原标题')
  })

  it('占位元素没有原 title 时回退为 null', () => {
    const image = el('<img src="x" data-external-src="https://e.example/a.png" title="提示">')
    expect(readImageTitle(image)).toBeNull()
  })

  it('普通元素读 src / title，缺失时用回退值', () => {
    const image = el('<img src="data:image/png;base64,AAAA" title="T">')
    expect(readImageSrc(image, '')).toBe('data:image/png;base64,AAAA')
    expect(readImageTitle(image)).toBe('T')
    const bare = el('<img>')
    expect(readImageSrc(bare, '')).toBe('')
    expect(readImageSrc(bare)).toBeNull()
    expect(readImageTitle(bare)).toBeNull()
  })
})
