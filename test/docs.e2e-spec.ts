import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import express from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';

/**
 * Minimal e2e test to ensure the OpenAPI spec is served and looks like YAML.
 */
describe('OpenAPI docs endpoint (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const server = express();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new ExpressAdapter(server));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /docs/openapi.yaml returns 200 and YAML content-type', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs/openapi.yaml')
      .expect(200);

    // Content-Type should include yaml or text/plain (depending on express version/mime)
    const contentType = res.headers['content-type'] || '';
    expect(/yaml|text\/plain/i.test(contentType)).toBeTruthy();

    // Sanity check payload begins with openapi: or --- YAML start
    const bodyText = res.text.trim();
    expect(/^openapi:|^---/.test(bodyText)).toBeTruthy();
  });
});
