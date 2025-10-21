import * as fs from 'fs';
import * as path from 'path';

/**
 * Registers Redoc UI at /docs and serves the OpenAPI spec at /docs/openapi.yaml
 * using the provided Express server instance.
 */
export function registerDocsRoutes(server: import('express').Express) {
  const specPath = path.join(process.cwd(), 'docs', 'contracts', 'openapi.yaml');

  server.get('/docs/openapi.yaml', (_req, res) => {
    res.type('application/yaml');
    res.send(fs.readFileSync(specPath, 'utf8'));
  });

  server.get('/docs', (_req, res) => {
    res.type('html');
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Chat Backend API Docs</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </head>
  <body>
    <redoc spec-url="/docs/openapi.yaml"></redoc>
  </body>
</html>`);
  });
}
