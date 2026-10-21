# NISO STS 1.2 官方 DTD（Interchange 标签集，MathML 3.0）

用途：GB/T 46687.2—2026 XML 的**辅助兼容性检查**，作为独立证据之一。验收基准是项目自写的 `../gbt46687.2/`（见 `docs/wp8.1/README.md` §3A）。
46687.2 修改采用 IEC/ISO Coding Guidelines，而该指南建立在 NISO STS 1.2 之上；对未修改的部分，本 DTD 给出精确的内容模型（元素顺序、基数等）。国标特有元素（如 `implementation-date`、`ccs`、`equivalence`）不在本 DTD 中，检查时应作为已知扩展单独列出。

## 来源

| 项 | 值 |
|---|---|
| 下载页 | https://www.niso-sts.org/DTDs-XSDs-RNGs-1-2.html |
| 文件 | https://www.niso-sts.org/downloadables/DTDs/v1-2/NISO-STS-interchange-1-2-MathML3-DTD.zip |
| zip SHA-256 | `fef588ea49aff8d0a72bafab00cc0c2bb0899666c478269ac39bc339d5b6a96a` |
| 获取日期 | 2026-10-21 |
| 主 DTD | `interchange-mathml3-dtd/NISO-STS-interchange-1-mathml3.dtd` |
| 内容 | zip 原样解压，未作任何修改 |

同一页面另有 RNG（`…-MathML3-RNG.zip`，SHA-256 `ef331ac3e68230fe8283caa00266c06d66a34b32dfefd04748f6b0d88b707286`）和 XSD（`…-MathML3-XSD.zip`，SHA-256 `4ee2d7730af3832e108aa8c27976684af797db601879f33541dc1e6244896ebd`）。官方说明 DTD、XSD、RNG 三种形式在逻辑上等价；为控制仓库体积，本目录只收录 DTD。

## 许可

Copyright © 2017, 2022 by ISO, the American Society of Mechanical Engineers (ASME), ASTM International, Mulberry Technologies, Inc., and the National Information Standards Organization (NISO).
按 [Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/) 授权。本目录文件原样再分发，保留各文件头部的版权与许可声明。

## 用法

```sh
xmllint --noout --nonet --dtdvalid schemas/niso-sts-1.2/interchange-mathml3-dtd/NISO-STS-interchange-1-mathml3.dtd <file.xml>
```
