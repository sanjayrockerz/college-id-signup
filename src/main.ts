import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('path/to/ssl/key.pem'),
    cert: fs.readFileSync('path/to/ssl/cert.pem'),
  };

  const app = await NestFactory.create(AppModule, { httpsOptions });

  // Enable CORS for frontend communication
  app.enableCors();

  // Enforce HSTS headers
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Start the application
  await app.listen(3000);
  console.log('Application is running on https://localhost:3000');
}
bootstrap();