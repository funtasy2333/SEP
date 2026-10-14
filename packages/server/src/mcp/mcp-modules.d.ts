/**
 * MCP 工具通过两个构建别名引用仓库里其他位置的文件（webpack 的 resolve.alias 与 package.json 的
 * jest.moduleNameMapper 各配置一份，见 webpack.config.js 的说明）。为避免 server 的 TS 程序检查 client 源码，
 * 这里手写声明。client 侧签名变化时必须同步修改。
 */

/**
 * packages/client/src/utils/newDocument.ts：编辑器首页「新建文档」生成文档的函数。
 * 只列出服务端用到的部分。
 */
declare module '@client/new-document' {
  import type {
    DocumentMeta,
    DocumentStage,
    PMJsonNode,
    StandardType,
  } from '@ses/shared';

  export interface NewDocForm {
    type: StandardType;
    stage: DocumentStage;
    stdPrefix: string;
    stdNo: string;
    titleCn: string;
    titleEn: string;
    icsCode: string;
    ccsCode: string;
    issuer: string;
    applicant: string;
    proposer: string;
    technicalCommittee: string;
    replaces: string;
    consistency: string;
    industryName?: string;
    regionName?: string;
    coverDesignation?: string;
  }

  /** 与编辑器保存新文档时提交的数据相同：标题、阶段、元数据和初始正文。 */
  export function createNewDocument(form: NewDocForm): {
    title: string;
    stage: DocumentStage;
    meta: DocumentMeta;
    content: PMJsonNode & Record<string, unknown>;
  };
}

/**
 * docs/wp9-authoring-reference.md 的全文：webpack 以 asset/source 内联进产物（部署时不需要 docs 目录），
 * jest 以文本转换器（jest.text-transform.js）加载。
 */
declare module '@docs/authoring-reference' {
  const markdown: string;
  export default markdown;
}
