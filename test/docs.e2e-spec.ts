import request from 'supertest';
import express from 'express';
import { registerDocsRoutes } from '../src/docs/registerDocs';

// Minimal integration test to ensure OpenAPI spec is served and looks like YAML.
describe('OpenAPI docs endpoint (integration)', () => {
  const server = express();
  registerDocsRoutes(server);

  it('GET /docs/openapi.yaml returns 200 and YAML content-type', async () => {
    const res = await request(server)
      .get('/docs/openapi.yaml')
      .expect(200);

    const contentType = res.headers['content-type'] || '';
    expect(/yaml|text\/plain/i.test(contentType)).toBeTruthy();

    const bodyText = res.text.trim();
    expect(/^openapi:|^---/.test(bodyText)).toBeTruthy();
  });
});
