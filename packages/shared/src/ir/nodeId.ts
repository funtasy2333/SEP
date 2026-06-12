import type { NodeId } from './types'

/** nodeId 字符表：字母数字（nanoid 风格），共 62 个字符 */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const NODE_ID_LENGTH = 12

/**
 * 生成稳定内部 nodeId：12 位字母数字随机串。
 *
 * 同构实现：仅依赖 `globalThis.crypto.getRandomValues`（浏览器与 Node 20+ 均可用），
 * 不引入 nanoid 依赖。62^12 ≈ 3.2e21，文档量级下碰撞概率可忽略。
 */
export function generateNodeId(): NodeId {
  const bytes = new Uint8Array(NODE_ID_LENGTH)
  globalThis.crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < NODE_ID_LENGTH; i++) {
    // 62 不整除 256，存在轻微取模偏差（约 2/256），对碰撞概率无实质影响
    id += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return id
}
