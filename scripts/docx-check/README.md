# scripts/docx-check/

本地核对 DOCX 渲染器输出用的核对工具（docs/wp7-docx-delivery.md §10.3）。**只用 Python 3
标准库 + PyMuPDF**（本机已装，`import fitz`），不是项目依赖，不进 CI，只在本机手动运行。

| 脚本 | 用法 | 作用 |
|---|---|---|
| `pack.py` | `pack.py <golden 目录> <out.docx>` | 把 shared 测试里 `__golden__/<fixture>/` 解包目录重新打成 `.docx` |
| `word_pdf.py` | `word_pdf.py <in.docx> <out.pdf>` | 用本机 Microsoft Word 把 `.docx` 转成 `.pdf`（macOS，AppleScript 自动化） |
| `measure.py` | `measure.py <pdf> [--pages A-B\|N] [--json]` | 300 dpi 渲染 PDF 每一页，量出书眉/首行/页码/页边距的毫米值 |
| `compare_pdf.py`（WP7.6） | `compare_pdf.py <baseline.pdf> <current.pdf>` | 对比两次Word输出的页数、尺寸、文字和150dpi灰度像素；差异退出1，逐页JSON仅证明所比较样稿 |
| `expect.py`（WP7.2） | `expect.py <pdf>` | 核对 `numbering` fixture 里嵌的期望标记，与 Word 实际排出的编号逐条比对 |

典型流程：`pack.py` 把测试生成的 golden 目录打成真正的 `.docx` → 在 Word 里人工打开核对
（或用 `word_pdf.py` 自动导出 PDF）→ `measure.py` 量出关键位置的毫米值，和 §2.1、§6.1 的
目标值比对；`numbering` fixture 另跑 `expect.py` 核对编号本身。

## pack.py

```
python3 scripts/docx-check/pack.py packages/shared/src/renderers/docx/__tests__/__golden__/minimal /tmp/minimal.docx
```

- `[Content_Types].xml` 固定放第一个条目，其余按包内路径排序，结果稳定可复现；
- golden 目录里 `.b64` 结尾的文件是二进制部件（图片等）的 base64 快照，解码后去掉 `.b64`
  后缀写入 zip；
- zip 条目时间统一写 `1980-01-01`（zip 允许的最早时间），避免因磁盘文件 mtime 不同产生
  字节级差异。

## word_pdf.py

```
python3 scripts/docx-check/word_pdf.py /tmp/minimal.docx /tmp/minimal.pdf
```

把 `.docx` 复制到 Word 的沙盒目录 `~/Library/Containers/com.microsoft.Word/Data/ses-check/`
后临时去掉副本中的打开时更新域与待更新标记，再用 AppleScript 驱动 Word 打开并核对指定副本的完整路径、更新其域
（包括 WP7.3 目次的 PAGEREF 页码）、另存为 PDF、不保存关闭。输入 DOCX 不会被修改。120 秒没结果
就报错退出，不会自己重试。

**Word 首次运行的授权步骤（只需一次）**：

1. macOS 系统设置 → 隐私与安全性 → 自动化，允许终端（或运行本脚本的程序）「控制
   Microsoft Word」。第一次调用本脚本时系统通常会自动弹出这个授权请求。
2. 输入输出文件必须在 Word 的沙盒目录内——本脚本已经处理（自动复制到
   `~/Library/Containers/com.microsoft.Word/Data/ses-check/`），不需要手动放文件。
3. 如果授权没有弹出或被拒绝，`osascript` 会在 120 秒后超时报错；去系统设置里手动允许后
   重新运行即可，不要在 120 秒内反复重试（同一个卡住的对话框不会因为重试而消失）。

## measure.py

```
python3 scripts/docx-check/measure.py spike/wp7-docx-word/spike-word.pdf --pages 2-9
```

300 dpi 灰度渲染每一页，灰度 < 128 的像素记为墨迹；纵向连续的「有墨迹的行」归为一个
「行块」。每页报告（mm，保留一位小数）：

- 首个行块的字顶、左右范围（有书眉的页，首个行块就是书眉）；
- 第二个行块的字顶（书眉之后的首行，或没有书眉的页的标题行）；
- 末个行块的底边距纸底（页码所在行）；
- 末个行块距外侧纸边：页序从 1 起算，单数页量右侧、双数页量左侧（镜像页边距下单数页外侧
  在右、双数页外侧在左，与 §2.3 页脚缩进方向一致）。

整页无墨迹时该页只报告「空白页」。加 `--json` 输出 JSON 数组，便于脚本化比对。

## expect.py（WP7.2）

```
python3 scripts/docx-check/expect.py /tmp/numbering.pdf
```

按 span 取文字，同一页上基线（span `origin` 的 y）相差不到 1pt 的 span 归为一个「视觉行」，
行内按 x 排序拼接。在视觉行里找 `numbering` fixture 嵌的三种期望标记：

- 「〔期望X〕」：本行去掉全部空白后以 X（同样去掉空白）开头，且紧接 X 的字符不是数字或
  「.」（避免「期望4」误配到 Word 实际排出的「4.1」）；
- 「〔前段期望X〕」：同一页的上一个视觉行去掉空白后等于 X（用于只有编号、没有文字的段落，
  如术语条目编号段、示例标识段）；
- 「〔附录期望X〕」：同一页往上第二个视觉行去掉空白后等于 X（附录标识段的第三行，往上第二
  行正是只含编号「附录A」的第一行）。

WP7.3 起目次条目也会复制标题中的期望标记；脚本跳过含连续点线的目次行，只核对正文中的
编号段落。逐条输出通过或失败及实际文字（同时打印到 stdout，方便直接贴进 PR）；有失败、
或一个标记也没找到时退出码为 1。

### 验收基准（对 `spike/wp7-docx-word/spike-word.pdf` 第 2–9 页）

以下基准值由主导人用同一算法实测（docs/wp7-docx-delivery.md §10.3），容差 ±0.3 mm（字顶
随首行字形不同有 0.2 mm 左右的出入）。第 1 页是 spike 的简化封面，不比对。

| 页 | 内容 | 首个行块字顶 | 第二个行块字顶 | 末个行块底边距纸底 | 距外侧纸边 |
|---|---|---|---|---|---|
| 2 | `oddPage` 插入的空白页 | 空白页 | | | |
| 3 | 目次 | 26.0 | 43.9 | 20.7 | 24.1 |
| 4 | 前言 | 26.0 | 43.9 | 20.7 | 24.1 |
| 5 | 正文首页 | 26.0 | 43.9 | 20.7 | 24.4 |
| 6 | 正文续页 | 26.0 | 35.3 | 20.7 | 24.0 |
| 7 | 附录 A | 26.0 | 44.3 | 20.7 | 24.2 |
| 8 | 附录 B | 26.0 | 44.3 | 20.7 | 24.0 |
| 9 | 参考文献 | 26.0 | 44.2 | 20.7 | 24.2 |

`python3 scripts/docx-check/measure.py spike/wp7-docx-word/spike-word.pdf --pages 2-9` 在
WP7.1 实测的结果与上表逐页逐列精确一致（见 PR 描述里的完整输出）。

## WP7.5 封面

- `prepare_cover_assets.py`：从本地 GB/T 1.1-2020 原件提取600dpi GB标志；其余使用已保存模板PNG，`--template-dir /absolute/templates` 可只读提取用户模板的DB/T/斜杠/Q及含发布的国家机构图片（固定媒体指纹、原像素、不重采样），重建内置base64；另需 Pillow 和 `pdfimages`。来源与限制见 `docs/wp7.5-cover-assets.md`。
- `cover_measure.py <pdf> --kind gb|guide|industry|local|group|enterprise [--sample-flow] [--json]`：在300dpi灰度图上测封面各元素墨迹，误差大于1mm时非零退出。`--sample-flow` 仅用于 `wp75-samples.mjs` 固定两行中文名称/英文的样稿。
- 完整生成命令、Word版本、逐项测量、人工DOCX/PDF路径和回归证据见 `docs/wp7.5-word-validation.md`。
