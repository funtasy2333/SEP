#!/usr/bin/env python3
"""word_pdf.py <in.docx> <out.pdf>

用本机 Microsoft Word（macOS）把 .docx 转成 .pdf，供本地核对用（不进 CI，不是自动化测试）。

步骤：
1. 把 <in.docx> 复制一份到 Word 沙盒目录
   ~/Library/Containers/com.microsoft.Word/Data/ses-check/ ——文件在沙盒内，Word 不会为了
   访问它弹「授权」窗口（首次仍需在系统设置里允许「控制 Microsoft Word」，见 README）；
2. 在这份副本里删掉 word/settings.xml 的 `<w:updateFields .../>`：留着的话 Word 打开时会弹
   「是否更新域」对话框，卡住自动化；`w:updateFields` 是产品本身需要的行为（打开时提示更新
   目次页码），这里只是核对脚本用的副本临时去掉，不影响交付稿；
3. AppleScript：打开副本 → 有目次就更新（包一层 try，没有目次或更新失败都不影响后续）→
   另存为 PDF → 关闭且不保存；
4. 把生成的 PDF 复制到 <out.pdf>；
5. 整个 AppleScript 调用 120 秒超时；超时或脚本报错都算失败，非零退出，不重试
   （超时多半是 Word 弹了对话框或授权窗口，需要人工处理）。

只用标准库（os/re/shutil/subprocess/sys/zipfile）；不是项目依赖，不进 CI。
"""

import os
import re
import shutil
import subprocess
import sys
import zipfile

SANDBOX_DIR = os.path.expanduser('~/Library/Containers/com.microsoft.Word/Data/ses-check')
TIMEOUT_SECONDS = 120
UPDATE_FIELDS_RE = re.compile(rb'<w:updateFields\b[^>]*/>')


def strip_update_fields(docx_path):
    """原地重写 docx_path：删掉 word/settings.xml 里的 <w:updateFields .../>（如果有）。"""
    with zipfile.ZipFile(docx_path, 'r') as zf:
        names = zf.namelist()
        if 'word/settings.xml' not in names:
            return
        infos = zf.infolist()
        contents = {info.filename: zf.read(info.filename) for info in infos}

    settings = contents['word/settings.xml']
    patched = UPDATE_FIELDS_RE.sub(b'', settings)
    if patched == settings:
        return

    contents['word/settings.xml'] = patched
    tmp_path = docx_path + '.tmp'
    with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for info in infos:
            zf.writestr(info, contents[info.filename])
    os.replace(tmp_path, docx_path)


def applescript_for(sandbox_docx, sandbox_pdf):
    # 逐行传给 osascript -e（与 spike/wp7-docx-word/README.md 里实测可行的写法一致）；
    # 目次更新包一层 try：minimal 等没有目次的 fixture 也能正常走完。
    return [
        'tell application "Microsoft Word"',
        f'open (POSIX file "{sandbox_docx}")',
        'try',
        'update (table of contents 1 of active document)',
        'end try',
        f'save as active document file name "{sandbox_pdf}" file format format PDF',
        'close active document saving no',
        'end tell',
    ]


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    in_docx = os.path.abspath(sys.argv[1])
    out_pdf = os.path.abspath(sys.argv[2])

    if not os.path.isfile(in_docx):
        print(f'错误：输入文件不存在: {in_docx}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(SANDBOX_DIR, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(in_docx))[0]
    sandbox_docx = os.path.join(SANDBOX_DIR, base_name + '.docx')
    sandbox_pdf = os.path.join(SANDBOX_DIR, base_name + '.pdf')

    shutil.copyfile(in_docx, sandbox_docx)
    if os.path.exists(sandbox_pdf):
        os.remove(sandbox_pdf)  # 避免复用上一次运行遗留的 PDF，掩盖这次的失败

    strip_update_fields(sandbox_docx)

    args = ['osascript']
    for line in applescript_for(sandbox_docx, sandbox_pdf):
        args += ['-e', line]

    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        print(
            f'错误：osascript 超过 {TIMEOUT_SECONDS} 秒无结果。多半是 Word 弹了对话框或授权'
            '窗口——按「未执行 + 原因」记录，不要反复重试。',
            file=sys.stderr,
        )
        sys.exit(1)

    if proc.returncode != 0:
        print(f'错误：AppleScript 执行失败（returncode={proc.returncode}）：{proc.stderr.strip()}', file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(sandbox_pdf):
        print(f'错误：Word 没有生成 PDF：{sandbox_pdf}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(out_pdf) or '.', exist_ok=True)
    shutil.copyfile(sandbox_pdf, out_pdf)
    print(f'written {out_pdf}')


if __name__ == '__main__':
    main()
