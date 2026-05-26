import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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

  const app = await NestFactory.create(AppModule);

  // 启用 CORS 允许前端访问
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  });

  // API 路径前缀
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`SES Server running on http://localhost:${port}`);
}
bootstrap();
