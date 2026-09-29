# WP7.4 Word 验收记录（2026-09-29）

环境：Microsoft Word for Mac 16.113.2。WPS 未安装，渲染结果未验证。

## 开工前机制样稿

用 `python-docx` 生成一个 75 行跨页表、一个横排节和已有原型的 5 个 OMML 公式；通过 `scripts/docx-check/word_pdf.py` 在 Word 中打开并导出 PDF。核验结果：第 2、3 页重复表头；横排页书眉位于顶部、页码位于底部且连续；分式、比较符与 `&`、求和、积分、根号均可见。此样稿只验证 Word 的机制，不代替产品导出验收。

## 产品导出样稿

生成命令：

```bash
node packages/client/scripts/wp74-sample.mjs "$PWD/tmp-e2e/wp7.4/WP7.4_Word验收样稿.docx"
python3 scripts/docx-check/word_pdf.py \
  "$PWD/tmp-e2e/wp7.4/WP7.4_Word验收样稿.docx" \
  "$PWD/tmp-e2e/wp7.4/WP7.4_Word验收样稿.pdf"
```

样稿经过真实的 `buildDocxBlob` 链；`tmp-e2e/` 被 Git 忽略，供本机人工打开。导出无 warning。DOCX ZIP 与 XML 均可解析，含 14 个 OMML 公式、3 个表格、1 张嵌入图片、2 个横排节。Word 未弹出修复提示，成功导出 12 页 PDF。

| 验收项 | Word 结果 |
|---|---|
| 14 个公式 | PDF 第 5 页显示（1）至（14）；包括 `<`、`&`、∑、∫、根号、矩阵、分段函数、括号包住 ∑；无公式降级 warning |
| 跨页表头 | 长表分布在 PDF 第 5–8 页，「项目／数值／说明」在每页表头重复 |
| 横纵合并 | `colspan=2` 且 `rowspan=2` 的续格带相同 `gridSpan=2` 和 `vMerge`；Word 第 5 页网格未错列 |
| 表注 | 位于表内最后一行；Word 第 8、9 页分别显示，未另成表外段 |
| 横排图表 | PDF 第 9 页为横排，图与表连续位于同一节；图片实际嵌入。第 10 页恢复竖排，页码从 5 续到 6 |
| 横排书眉页码 | 第 9 页单数书眉右缘 x=785 pt，距 842 pt 页宽约 20 mm；第 12 页双数书眉左缘 x=71 pt，页码在下方外侧 |
| 末尾横排终结线 | 第 12 页横排末表下方可见；与表同页，Word PDF 实测线宽约 62 mm，约为 252 mm 横排版心的四分之一 |
| WP7.3 行为 | 目次页码 I/II 与正文 1、附录 7 正常；导出仍走原 `buildDocxBlob` 与固定目次/PAGEREF 机制 |

封面仍是 WP7.2/7.3 的文件编号占位，属于 WP7.5。WPS 未验证。
