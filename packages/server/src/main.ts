import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { mkdirSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
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
