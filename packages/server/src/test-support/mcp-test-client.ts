// 工具结果正文是运行时解析出来的 JSON（形状因工具而异），用例按需逐字段断言，不为每种形状单独声明类型。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TestApp } from './test-app';

/** 测试用的 MCP 客户端：SDK 的 Client + Streamable HTTP，连接 test-app 监听的真实端口。 */
export interface McpTestClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
  /** 工具调用，返回解析后的正文。成功时是工具结果 JSON，失败时是 `{ status, message, … }`。 */
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ isError: boolean; body: any; structured: unknown }>;
  /** 断开连接（不通知服务端）。 */
  close(): Promise<void>;
}

export const TEST_CLIENT_INFO = { name: 'ses-test-client', version: '1.2.3' };

export async function connectMcp(
  t: Pick<TestApp, 'url'>,
  clientInfo: { name: string; version: string } = TEST_CLIENT_INFO,
): Promise<McpTestClient> {
  const transport = new StreamableHTTPClientTransport(new URL(`${t.url}/mcp`));
  const client = new Client(clientInfo);
  await client.connect(transport);
  return {
    client,
    transport,
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? '';
      return {
        isError: result.isError === true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        body: JSON.parse(text),
        structured: result.structuredContent,
      };
    },
    close: () => client.close(),
  };
}
