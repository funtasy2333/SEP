#!/usr/bin/env python3
"""pack.py <golden 目录> <out.docx>

把 shared 测试里的 __golden__/<fixture>/ 解包目录重新打成 .docx（zip）：

- `[Content_Types].xml` 放第一个条目；
- 其余条目按包内路径（zip 内相对路径，用 "/" 分隔）排序，结果稳定可复现；
- `.b64` 结尾的文件是 shared 测试对二进制部件（图片等）的 base64 快照，这里解码还原成
  二进制内容，写入 zip 时去掉 `.b64` 后缀；
- zip 条目的时间统一写 1980-01-01（zip 时间戳允许的最早值），避免每次重新打包时因为磁盘
  文件的 mtime 不同而产生字节级差异。

只用标准库；不是项目依赖，不进 CI。
"""

import base64
import os
import sys
import zipfile

FIXED_DATE_TIME = (1980, 1, 1, 0, 0, 0)
CONTENT_TYPES = '[Content_Types].xml'


def collect_entries(root):
    """遍历 root，返回 [(zip 内路径, 磁盘路径, 是否 base64)]，已按打包顺序排序。"""
    entries = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            disk_path = os.path.join(dirpath, name)
            rel = os.path.relpath(disk_path, root)
            zip_path = rel.replace(os.sep, '/')
            is_b64 = zip_path.endswith('.b64')
            if is_b64:
                zip_path = zip_path[: -len('.b64')]
            entries.append((zip_path, disk_path, is_b64))

    def sort_key(entry):
        zip_path = entry[0]
        return (0, '') if zip_path == CONTENT_TYPES else (1, zip_path)

    entries.sort(key=sort_key)
    return entries


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    golden_dir, out_path = sys.argv[1], sys.argv[2]

    if not os.path.isdir(golden_dir):
        print(f'错误：目录不存在: {golden_dir}', file=sys.stderr)
        sys.exit(1)

    entries = collect_entries(golden_dir)
    if not entries:
        print(f'错误：{golden_dir} 里没有文件', file=sys.stderr)
        sys.exit(1)
    if entries[0][0] != CONTENT_TYPES:
        print(f'错误：{golden_dir} 里没有 {CONTENT_TYPES}', file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for zip_path, disk_path, is_b64 in entries:
            with open(disk_path, 'rb') as f:
                data = f.read()
            if is_b64:
                data = base64.b64decode(data)
            info = zipfile.ZipInfo(zip_path, date_time=FIXED_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)

    print(f'written {out_path}（{len(entries)} 个部件）')


if __name__ == '__main__':
    main()
