# CI/CD Hardening Specification

**Version**: 1.0  
**Effective Date**: 2025-10-20  
**Authority**: DevOps Team  
**Review Cycle**: Quarterly

---

## Overview

This document defines **production-grade CI/CD pipeline requirements** for the chat backend, ensuring:
- Automated quality gates prevent regressions
- Security vulnerabilities blocked before deployment
- Reproducible builds with artifact signing
- Safe deployment with automated rollback
- Audit trail for compliance (SOC 2, GDPR)

---

## Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Developer Workflow                        │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼
       ┌─────────────────┐
       │  Git Push        │
       │  (main branch)   │
       └────────┬─────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────┐
│                      CI Pipeline (GitHub Actions)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  Static      │  │  Tests       │  │  Security    │             │
│  │  Analysis    │  │  (Unit+Int)  │  │  Scans       │             │
│  │  ├─TypeCheck │  │  ├─Jest      │  │  ├─Snyk      │             │
│  │  ├─ESLint    │  │  ├─Coverage  │  │  ├─Trivy     │             │
│  │  └─Prettier  │  │  └─E2E Tests │  │  └─SAST      │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                  │                     │
│         └──────────────────┴──────────────────┘                     │
│                            │                                        │
│                  ┌─────────▼─────────┐                             │
│                  │  Quality Gate     │                             │
│                  │  (All must pass)  │                             │
│                  └─────────┬─────────┘                             │
│                            │ PASS                                  │
│                            ▼                                        │
│                  ┌─────────────────┐                               │
│                  │  Build Artifact │                               │
│                  │  (Docker Image) │                               │
│                  └─────────┬───────┘                               │
│                            │                                        │
│                            ▼                                        │
│                  ┌─────────────────┐                               │
│                  │  Sign & Publish │                               │
│                  │  (ECR + SBOM)   │                               │
│                  └─────────┬───────┘                               │
└──────────────────────────────┼─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                     CD Pipeline (ArgoCD / GitHub)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  Deploy      │  │  Smoke Tests │  │  Monitor     │             │
│  │  Staging     │  │  (Health)    │  │  (5 min)     │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                  │                     │
│         └──────────────────┴──────────────────┘                     │
│                            │ PASS                                  │
│                  ┌─────────▼─────────┐                             │
│                  │  Approval Gate    │                             │
│                  │  (Manual/Auto)    │                             │
│                  └─────────┬─────────┘                             │
│                            │ APPROVED                              │
│                  ┌─────────▼─────────┐                             │
│                  │  Deploy Production│                             │
│                  │  (Blue/Green)     │                             │
│                  └─────────┬─────────┘                             │
│                            │                                        │
│                  ┌─────────▼─────────┐                             │
│                  │  Automated        │                             │
│                  │  Rollback         │                             │
│                  │  (if errors >1%)  │                             │
│                  └───────────────────┘                             │
└────────────────────────────────────────────────────────────────────┘
```

---

## Branch Protection Rules

### Main Branch

**Required Checks** (GitHub):
```yaml
branches:
  - name: main
    protection:
      required_status_checks:
        strict: true  # Require branch up-to-date before merge
        contexts:
          - ci/typecheck
          - ci/lint
          - ci/test-unit
          - ci/test-integration
          - ci/security-scan
          - ci/coverage
      required_pull_request_reviews:
        required_approving_review_count: 2
        dismiss_stale_reviews: true
        require_code_owner_reviews: true
      enforce_admins: true  # No bypassing for admins
      restrictions:
        users: []
        teams: ['backend-team']
```

**CODEOWNERS** (enforce review by domain experts):
```
# /.github/CODEOWNERS
*                           @backend-team
/prisma/                    @dba-team
/src/infra/                 @devops-team
/docs/governance/           @engineering-manager
```

---

## Automated Quality Gates

### 1. TypeScript Type Checking

**Strict Mode** (zero tolerance for type errors):

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

**CI Job**:
```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
        # Fails if any type errors
```

---

### 2. Linting (ESLint)

**Zero Warnings Policy**:

```javascript
// .eslintrc.js
module.exports = {
  extends: [
    '@nestjs/eslint-plugin',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:security/recommended'
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    'security/detect-non-literal-fs-filename': 'error',
    'security/detect-eval-with-expression': 'error'
  }
};
```

**CI Job**:
```yaml
lint:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
    - run: npm ci
    - run: npm run lint
      # Fails if any errors or warnings
    - run: npm run format:check
      # Prettier formatting check
```

---

### 3. Unit + Integration Tests

**Coverage Requirements**:
- Overall: >75%
- Critical paths (message send, conversation create): >90%

```json
// jest.config.json
{
  "coverageThreshold": {
    "global": {
      "branches": 75,
      "functions": 75,
      "lines": 75,
      "statements": 75
    },
    "./src/chat-backend/services/message.service.ts": {
      "branches": 90,
      "functions": 90,
      "lines": 90,
      "statements": 90
    }
  }
}
```

**CI Job**:
```yaml
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:15
      env:
        POSTGRES_PASSWORD: testpass
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
    - run: npm ci
    - run: npm run test:cov
      env:
        DATABASE_URL: postgresql://postgres:testpass@postgres:5432/testdb
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage/lcov.info
        fail_ci_if_error: true
```

---

### 4. Security Scanning

**Vulnerability Scanning** (Snyk + Trivy):

```yaml
security-scan:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    
    # Dependency vulnerabilities
    - name: Run Snyk
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      with:
        args: --severity-threshold=high  # Fail on high/critical

    # Container image vulnerabilities
    - name: Build Docker image
      run: docker build -t chat-backend:${{ github.sha }} .
    
    - name: Run Trivy
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: chat-backend:${{ github.sha }}
        severity: 'HIGH,CRITICAL'
        exit-code: '1'  # Fail CI on vulnerabilities

    # Static Application Security Testing
    - name: Run CodeQL
      uses: github/codeql-action/analyze@v2
      with:
        languages: typescript
```

**SAST Rules** (CodeQL):
```yaml
# .github/codeql/codeql-config.yml
queries:
  - uses: security-and-quality
  - uses: security-extended
paths-ignore:
  - '**/node_modules'
  - '**/test'
```

---

### 5. Prisma Schema Validation

**Prevent Breaking Changes**:

```yaml
prisma-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - run: npm ci
    
    # Validate schema syntax
    - run: npx prisma validate
    
    # Check for breaking schema changes
    - name: Detect breaking changes
      run: |
        git fetch origin main
        git diff origin/main -- prisma/schema.prisma > schema-diff.txt
        if grep -q "@@map\|@@id\|@relation" schema-diff.txt; then
          echo "⚠️  Breaking schema change detected. Requires migration approval."
          exit 1
        fi
```

---

## Build & Publish

### Docker Image

**Multi-stage Build** (optimize size):

```dockerfile
# Dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
RUN npx prisma generate

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**Build Job**:
```yaml
build:
  needs: [typecheck, lint, test, security-scan]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v2
    
    - name: Build image
      uses: docker/build-push-action@v4
      with:
        context: .
        push: false
        tags: chat-backend:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
    
    - name: Generate SBOM (Software Bill of Materials)
      uses: anchore/sbom-action@v0
      with:
        image: chat-backend:${{ github.sha }}
        format: cyclonedx-json
        output-file: sbom.json
    
    - name: Sign image
      uses: sigstore/cosign-installer@v3
      with:
        cosign-release: 'v2.0.0'
    - run: |
        cosign sign --key env://COSIGN_PRIVATE_KEY \
          chat-backend:${{ github.sha }}
      env:
        COSIGN_PRIVATE_KEY: ${{ secrets.COSIGN_PRIVATE_KEY }}
    
    - name: Push to ECR
      uses: docker/build-push-action@v4
      with:
        push: true
        tags: |
          123456789.dkr.ecr.us-east-1.amazonaws.com/chat-backend:${{ github.sha }}
          123456789.dkr.ecr.us-east-1.amazonaws.com/chat-backend:latest
```

---

### Semantic Versioning

**Automated Version Bumping**:

```yaml
version:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
      with:
        fetch-depth: 0  # Fetch full history
    
    - name: Semantic Release
      uses: cycjimmy/semantic-release-action@v3
      with:
        branches: |
          [
            'main'
          ]
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Commit Convention** (Conventional Commits):
```
feat: Add message reactions feature
fix: Prevent duplicate message delivery
BREAKING CHANGE: Remove deprecated /v1/messages endpoint
```

**Version Tagging**:
- `feat:` → Minor version bump (1.0.0 → 1.1.0)
- `fix:` → Patch version bump (1.0.0 → 1.0.1)
- `BREAKING CHANGE:` → Major version bump (1.0.0 → 2.0.0)

---

## Deployment Pipeline

### Staging Deployment (Automatic)

```yaml
deploy-staging:
  needs: [build]
  runs-on: ubuntu-latest
  environment: staging
  steps:
    - name: Deploy to ECS
      run: |
        aws ecs update-service \
          --cluster chat-backend-staging \
          --service chat-backend \
          --force-new-deployment \
          --task-definition chat-backend:${{ github.sha }}
    
    - name: Wait for deployment
      run: |
        aws ecs wait services-stable \
          --cluster chat-backend-staging \
          --services chat-backend
    
    - name: Smoke tests
      run: |
        curl -f https://chat-backend-staging.internal/api/v1/health
        curl -f https://chat-backend-staging.internal/metrics
```

---

### Production Deployment (Manual Approval)

```yaml
deploy-production:
  needs: [deploy-staging]
  runs-on: ubuntu-latest
  environment:
    name: production
    url: https://chat-backend.company.com
  steps:
    - name: Wait for approval
      uses: trstringer/manual-approval@v1
      with:
        approvers: backend-team,sre-team
        minimum-approvals: 2
    
    - name: Blue/Green Deployment
      run: |
        # Deploy to green environment
        aws ecs update-service \
          --cluster chat-backend-prod \
          --service chat-backend-green \
          --task-definition chat-backend:${{ github.sha }}
        
        # Wait for green healthy
        aws ecs wait services-stable \
          --cluster chat-backend-prod \
          --services chat-backend-green
        
        # Switch traffic (ALB target group)
        aws elbv2 modify-listener \
          --listener-arn arn:aws:elasticloadbalancing:... \
          --default-actions Type=forward,TargetGroupArn=arn:...green
        
        # Monitor for 5 minutes
        sleep 300
        
        # Check error rate
        ERROR_RATE=$(curl -s https://prometheus.internal/api/v1/query \
          --data-urlencode 'query=rate(http_requests_total{status=~"5.."}[5m])' | \
          jq '.data.result[0].value[1] | tonumber')
        
        if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
          echo "⚠️  Error rate too high ($ERROR_RATE). Rolling back..."
          # Switch back to blue
          aws elbv2 modify-listener \
            --listener-arn arn:aws:elasticloadbalancing:... \
            --default-actions Type=forward,TargetGroupArn=arn:...blue
          exit 1
        fi
        
        echo "✅ Deployment successful. Error rate: $ERROR_RATE"
```

---

### Rollback Procedure

**Automated Rollback Triggers**:
- Error rate >1% for 5 minutes
- p95 latency >2s for 5 minutes
- Health check failures >10%

**Manual Rollback**:
```bash
# List recent deployments
aws ecs list-task-definitions --family-prefix chat-backend | jq '.taskDefinitionArns[-5:]'

# Rollback to previous version
aws ecs update-service \
  --cluster chat-backend-prod \
  --service chat-backend \
  --task-definition chat-backend:42  # Previous version
```

---

## Audit Trail

### Deployment Logs

**Record in Slack**:
```yaml
- name: Notify deployment
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: |
      *Production Deployment*
      Version: ${{ github.sha }}
      Deployer: ${{ github.actor }}
      Changes: ${{ github.event.head_commit.message }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

**Record in Database** (for compliance):
```sql
CREATE TABLE deployment_audit (
  id SERIAL PRIMARY KEY,
  version VARCHAR(40) NOT NULL,
  environment VARCHAR(20) NOT NULL,
  deployed_by VARCHAR(100) NOT NULL,
  deployed_at TIMESTAMP DEFAULT NOW(),
  commit_message TEXT,
  rollback_version VARCHAR(40)
);

INSERT INTO deployment_audit (version, environment, deployed_by, commit_message)
VALUES ('abc123', 'production', 'github-actions', 'feat: Add reactions');
```

---

## Monitoring Post-Deployment

**5-Minute Canary Period**:
```yaml
- name: Monitor deployment
  run: |
    for i in {1..10}; do
      ERROR_RATE=$(curl -s https://prometheus.internal/api/v1/query \
        --data-urlencode 'query=rate(http_requests_total{status=~"5.."}[1m])' | \
        jq '.data.result[0].value[1] | tonumber')
      
      echo "[$i/10] Error rate: $ERROR_RATE"
      
      if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
        echo "⚠️  Triggering rollback"
        exit 1
      fi
      
      sleep 30
    done
```

---

## Secrets Management

**GitHub Secrets**:
```yaml
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  JWT_SECRET: ${{ secrets.JWT_SECRET }}
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

**Runtime Secrets** (AWS Secrets Manager):
```typescript
// src/config/database.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

async function getDatabaseUrl(): Promise<string> {
  const client = new SecretsManager({ region: 'us-east-1' });
  const response = await client.getSecretValue({ SecretId: 'chat-backend/db-url' });
  return JSON.parse(response.SecretString).url;
}
```

---

## Performance Benchmarks

**Build Time Target**: <5 minutes

**Deployment Time Target**: <10 minutes (including smoke tests)

**Current Benchmarks** (to be measured in Task 5):
- TypeCheck: TBD
- Lint: TBD
- Tests: TBD
- Build: TBD
- Total CI time: TBD

---

## Compliance Checklist

- [ ] All commits signed (GPG)
- [ ] Pull request approvals recorded
- [ ] Security scans pass (no high/critical vulnerabilities)
- [ ] SBOM generated and stored
- [ ] Docker image signed (Cosign)
- [ ] Deployment audit trail in database
- [ ] Secrets rotated quarterly
- [ ] Dependency updates automated (Dependabot)

---

**Version**: 1.0  
**Last Updated**: 2025-10-20  
**Next Review**: 2026-01-20
