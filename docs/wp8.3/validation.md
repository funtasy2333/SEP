# WP8.3 外部裁判与矩阵核对

外部裁判用于 XML 格式与语义回归，不执行产品导入、资源加载或生产 Schema 转换。本地自写样例与 lxml/xmllint 的结果不构成真实样稿互操作结论。

严格导入约定与 P1 建议专码对应如下（Python 保留原 V 规则作为错误码）：

| 规则 | Python | P1 建议码 | 内容 |
|---|---|---|---|
| R1 | V-17 | xml-annex-type-required | app 必须有直接 annex-type |
| R2 | V-8 | xml-xref-custom-type-required | custom xref 必须有 custom-type |
| R3 | V-17 | xml-ext-link-type-invalid | ext-link-type 必须为 uri |
| R4 | V-15 | xml-math-display-invalid | 行间显式 block、行内不得指定 |
| R5 | V-14 | xml-math-id-required | 公式直接 MathML 根须有 id |
| R6 | V-13 | xml-app-id-required | app 须有 id |
| R7 | V-13 | xml-bibl-ref-id-required | bibl/bibr 直接 ref 须有 id；norm-refs ref 不强制 |
| R8 | V-13 | xml-term-id-required | TBX termEntry 须有 id |
| R9 | V-18 | xml-paragraph-id-forbidden | 无命名空间 p 不得有无命名空间 id |
| R10 | V-17 | xml-section-label-required | body/app 后代 sec 须有非空直接 label |
| R11 | V-12 | xml-meta-order-invalid | 次序 A/B 任一非降序，B 告警；其他错误 |
| R12 | V-17 | xml-table-label-required | table-wrap 须有非空直接 label |
| R13 | V-9 | xml-term-definition-count | 各 langSet 中 definition 合计恰好一个 |

13 项此前 import 接受或告警，现按所列上下文 error；不按文件名处理。两种 MathML 前缀及默认命名空间均按 URI 识别。DOCTYPE 一律拒绝，不读取外部子集；多目标 rid 拒绝。已授权的引言条、array、disp-formula-group 和共享脚注不再产生旧 implementation 拒绝告警。格式检查不证明模型和资源可导入。

支持矩阵动态统计：391 行中 accept 203、required 156、format reject 25、not-applicable 7；shall/should 的 accept/required 为 188 行。M-4.1-02 从 accept 改 format reject；M-4.3.4-02、M-4.3.4-03、M-5.8-01、M-C.1-04、M-C.1-05、M-10.1.8-04 从 implementation reject 改 accept。原拒绝以外的矩阵行状态未变。

旧 V-7 与旧格式检测仍按部分 ID 字面值拒绝；UUID 形 fig id 样例与 ID 为不透明关联键存在冲突，待主导及用户决定，不应将该兼容性争议称为已解决。
