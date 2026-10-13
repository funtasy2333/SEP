import { inflateRawSync } from 'zlib';

/**
 * 测试用最小 ZIP 读取器：按中央目录取出每个条目的原始字节。
 * 服务端没有（也不应为测试新增）zip 依赖，DOCX 部件检查用这个即可。
 * 只支持存储（0）与 DEFLATE（8）两种压缩方式，不支持 ZIP64，足够读 @ses/io 产出的 DOCX。
 */
export function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== END_OF_CENTRAL_DIRECTORY) {
    eocd -= 1;
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP：找不到中央目录结尾记录');

  const entryCount = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('ZIP 中央目录条目损坏');
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    // 本地头的名称/扩展区长度可能与中央目录不同，数据起点以本地头为准。
    const dataStart =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) {
      throw new Error(`ZIP 条目 ${name} 使用了不支持的压缩方式 ${method}`);
    }
    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
