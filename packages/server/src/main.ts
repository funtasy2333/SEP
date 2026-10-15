import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';
import {
  formatListenUrl,
  NON_LOOPBACK_WARNING,
  resolveListenAddress,
} from './listen-host';
import { mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '../../.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env 不存在时忽略
  }
}

async function bootstrap() {
  loadEnv();

  // 确保数据目录存在
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // JSON 请求体上限与路由前缀（/api；MCP 端点 /mcp 不带前缀）：与测试应用共用同一份配置
  configureApp(app);

  // 启用 CORS 允许前端访问
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  });

  // 默认只监听本机（127.0.0.1）：REST 接口没有鉴权。SES_LISTEN_HOST 可覆盖，见 listen-host.ts。
  const port = process.env.PORT ?? 3000;
  const { host, loopback } = resolveListenAddress();
  await app.listen(port, host);
  console.log(`SES Server running on ${formatListenUrl(host, port)}`);
  if (!loopback) console.warn(`警告：${NON_LOOPBACK_WARNING}`);
}
bootstrap();
