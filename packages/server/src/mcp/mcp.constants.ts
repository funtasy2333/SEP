import { SES_SERVER_VERSION } from '../common/app-version';

/**
 * MCP 端点的路径（不带 `api` 前缀）。控制器路由与 `configureApp` 的前缀排除共用这一个值，
 * 两处不会写岔。
 */
export const MCP_PATH = 'mcp';

/** 服务端在 `initialize` 响应中报告的名称与版本。 */
export const MCP_SERVER_INFO = {
  name: 'ses',
  version: SES_SERVER_VERSION,
} as const;

/** 编辑器的默认地址（Vite 开发服务器）；部署时用环境变量 SES_EDITOR_BASE_URL 覆盖。 */
export const DEFAULT_EDITOR_BASE_URL = 'http://localhost:5173';

/**
 * `initialize` 响应里的 instructions：客户端通常把它放进模型的系统提示。
 * 只写工作流；各工具的参数与返回值写在工具自己的描述里，写作格式由 get_authoring_reference 提供。
 */
export const MCP_INSTRUCTIONS = [
  'SES（标准化文件编辑系统）：与人共同起草 GB/T 1.1 风格的标准文件。推荐流程：',
  '1. 首次使用先调用 get_authoring_reference，了解可写入的内容格式（写作片段）与结构约定；',
  '2. 用 list_documents 找到文档（或用 create_document 新建），再用 get_outline 查看结构树，用 get_node 读取需要修改的节点或前言、引言、参考文献；',
  '3. 用 apply_operations 修改文档：baseRevision 必须取最近一次读取或写入返回的 revision；整批操作全有或全无，不合法时返回带路径的问题，文档保持不变；',
  '4. 遇到 revision 冲突（status 409）说明文档已被人或其他 AI 修改：先重新读取，在新内容的基础上重新生成操作，不要只换上新的 revision 就重发原来的操作；',
  '5. 写完后用 validate_document 检查：problems 是文档的结构问题，exports 说明 docx、pdf、html 能否出件；有问题先修正，再用 export_document 出件。不给 outputPath 只返回下载地址；用户要文件时，把 outputPath 设为文件名（如「规范.docx」，扩展名与 format 一致），文件会保存到服务端的导出目录，返回的 savedTo 是实际路径，请告诉用户。outputPath 只能写到服务端允许的目录内，写到别处会被拒绝（403 output-dir-not-allowed），此时请用户把目录加入 SES_MCP_OUTPUT_DIRS，不要换路径绕过。目标已存在默认失败，征得用户同意才设 overwrite；',
  '6. 修改直接生效，并在版本历史中记为「AI 修改」，人可以在编辑器中查看并回滚。',
].join('\n');
