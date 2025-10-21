# Developer Onboarding

## Prerequisites
- Node 18+
- Docker
- Postgres 14+

## Local Setup
```bash
npm install
cp .env.example .env
# Edit DATABASE_URL
npm run prisma:migrate
npm run start:dev
```

## Testing
```bash
npm test
npm run test:e2e -- --passWithNoTests
# Optional: k6 run docs/performance/k6-load-test.js
```

## Deployment
```bash
npm run build
# docker build -t registry/chat-backend:2.0.0 .
# docker push registry/chat-backend:2.0.0
# kubectl apply -f k8s/
```

## Troubleshooting
- DB connection refused: check DATABASE_URL and DB is running
- Port 3001 in use: kill previous dev server
- Prisma mock mode: set PRISMA_CLIENT_MODE=database
