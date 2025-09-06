import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Enable CORS for frontend communication
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // Global prefix for API routes
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3001;

  // HTTPS configuration for production
  if (process.env.NODE_ENV === 'production' && process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    const httpsOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    };
    
    // Note: For HTTPS, you would need to use NestFactory.create(AppModule, { httpsOptions })
    console.log(`Application is running on https://localhost:${port}`);
  } else {
    console.log(`Application is running on http://localhost:${port}`);
    console.log('Available endpoints:');
    console.log(`  - Feed: http://localhost:${port}/api/v1/feed`);
    console.log(`  - Posts: http://localhost:${port}/api/v1/posts`);
    console.log(`  - Upload: http://localhost:${port}/api/v1/upload/image`);
    console.log(`  - Users: http://localhost:${port}/api/v1/users`);
    console.log(`  - Connections: http://localhost:${port}/api/v1/connections`);
    console.log(`  - Interactions: http://localhost:${port}/api/v1/interactions`);
  }

  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});