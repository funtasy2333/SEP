# WP4 开工首日微验证 — `break-before: right` + `:blank` + `counter-reset: page`

**结论：✅ 通过（有一条必须遵守的实现约束，已纳入 printCss.ts）**

构建命令（锁定 CLI 11.0.1，与 WP0 spike 同引擎）：
```
pnpm --package=@vivliostyle/cli@11.0.1 dlx vivliostyle build spike/wp4-microtest/index.html -o spike/wp4-microtest/out.pdf
```

## 验证场景

前置页 1 页（物理第 1 页，奇数，罗马页码 I）→ 正文首章 `h1.chapter-title { break-before: right }`。
正文应落在奇数（recto）物理页，二者之间需自动插入一张空白页（物理第 2 页）。

## 实测结果（pdfinfo / pdftotext 逐页核验）

| 物理页 | 内容 | 页脚 | 结论 |
|---|---|---|---|
| 1 | 前置页 | Ⅰ（罗马） | ✓ |
| 2 | **自动插入的空白页** | （无） | ✓ 真正空白，无任何文字 |
| 3 | 正文首章 | 1（阿拉伯，已重置） | ✓ recto 起排 + 从 1 起编 |
| 4 | 正文第二页 | 2 | ✓ |

三项机制可同时成立：
1. `break-before: right` 正确将正文首章推到奇数物理页，并在需要时插入空白页；
2. `counter-reset: page 1`（命名页 `body` 上）正确使正文从 1 重新起编（与 WP0 结论 2 一致）；
3. 空白页可计数但不印内容。

## 关键约束（已写入 printCss.ts）

自动插入的空白页**归属其前一个命名页上下文**（本例为 `front`）。探针实测：
`@page front:blank` 命中该空白页，`@page body:blank` 不命中。

因此抑制空白页页眉页脚**必须用带命名上下文的 `@page <name>:blank`**，
裸 `@page :blank` 会在层叠中输给更具体的 `@page <name>` 的 margin box 规则，导致空白页仍印出页码。
printCss.ts 对 `front` / `body` / `landscape` 三个命名上下文均显式清空全部 margin box。

> 与 WP0「内部链接与命名横排页互斥」结论独立：本微验证 HTML 无内部链接，符合 print 变体约束。
