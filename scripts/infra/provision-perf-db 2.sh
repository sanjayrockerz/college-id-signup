#!/bin/bash
# Performance Database Provisioning Script
# 
# Purpose: Create isolated, monitored, safe environment for large-scale data tests
# Owner: DevOps/SRE
# Version: 1.0.0
#
# Usage:
#   ./provision-perf-db.sh --env [dev|staging|perf] --host localhost --port 5432
#
# Safety:
#   - Isolated database with separate credentials
#   - pg_stat_statements enabled for query monitoring
#   - Autovacuum tuned for high-churn tables
#   - Disk space validation before operations

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
ENV=""
ADMIN_HOST="${POSTGRES_HOST:-localhost}"
ADMIN_PORT="${POSTGRES_PORT:-5432}"
ADMIN_USER="${POSTGRES_ADMIN_USER:-postgres}"
ADMIN_PASS="${POSTGRES_ADMIN_PASS:-password}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV="$2"
      shift 2
      ;;
    --host)
      ADMIN_HOST="$2"
      shift 2
      ;;
    --port)
      ADMIN_PORT="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 --env [dev|staging|perf] [--host HOST] [--port PORT]"
      echo ""
      echo "Options:"
      echo "  --env ENV      Environment: dev, staging, or perf (required)"
      echo "  --host HOST    PostgreSQL host (default: localhost)"
      echo "  --port PORT    PostgreSQL port (default: 5432)"
      echo "  --help         Show this help"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Validate required arguments
if [[ -z "$ENV" ]]; then
  echo -e "${RED}ERROR: --env is required${NC}"
  echo "Usage: $0 --env [dev|staging|perf]"
  exit 1
fi

if [[ ! "$ENV" =~ ^(dev|staging|perf)$ ]]; then
  echo -e "${RED}ERROR: --env must be dev, staging, or perf${NC}"
  exit 1
fi

# Configuration per environment
case $ENV in
  dev)
    DB_NAME="chat_perf_dev"
    DB_USER="perf_dev_user"
    TARGET_MESSAGES=5000000
    TARGET_USERS=5000
    WORK_MEM="64MB"
    SHARED_BUFFERS="256MB"
    MAINTENANCE_WORK_MEM="128MB"
    ;;
  staging)
    DB_NAME="chat_perf_staging"
    DB_USER="perf_staging_user"
    TARGET_MESSAGES=100000000
    TARGET_USERS=150000
    WORK_MEM="128MB"
    SHARED_BUFFERS="1GB"
    MAINTENANCE_WORK_MEM="512MB"
    ;;
  perf)
    DB_NAME="chat_perf"
    DB_USER="perf_user"
    TARGET_MESSAGES=300000000
    TARGET_USERS=250000
    WORK_MEM="256MB"
    SHARED_BUFFERS="2GB"
    MAINTENANCE_WORK_MEM="1GB"
    ;;
esac

# Generate secure random password
DB_PASS=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Performance Database Provisioning - ${ENV^^} Environment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Configuration:${NC}"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Host: $ADMIN_HOST:$ADMIN_PORT"
echo "  Target Messages: $(printf "%'d" $TARGET_MESSAGES)"
echo "  Target Users: $(printf "%'d" $TARGET_USERS)"
echo ""

# Step 1: Check connectivity
echo -e "${BLUE}[1/8]${NC} Checking PostgreSQL connectivity..."
if ! PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres -c "SELECT version();" > /dev/null 2>&1; then
  echo -e "${RED}✗ Failed to connect to PostgreSQL${NC}"
  echo "  Host: $ADMIN_HOST:$ADMIN_PORT"
  echo "  User: $ADMIN_USER"
  exit 1
fi
echo -e "${GREEN}✓ Connected to PostgreSQL${NC}"

# Step 2: Check disk space
echo -e "${BLUE}[2/8]${NC} Validating disk space..."
PG_DATA_DIR=$(PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres -t -c "SHOW data_directory;" | xargs)
AVAILABLE_GB=$(df -BG "$PG_DATA_DIR" | tail -1 | awk '{print $4}' | sed 's/G//')

# Estimate required space: ~500 bytes per message + indexes (3x)
REQUIRED_GB=$((TARGET_MESSAGES * 500 / 1024 / 1024 / 1024 * 4))

if [[ $AVAILABLE_GB -lt $REQUIRED_GB ]]; then
  echo -e "${RED}✗ Insufficient disk space${NC}"
  echo "  Available: ${AVAILABLE_GB}GB"
  echo "  Required: ${REQUIRED_GB}GB (estimated)"
  exit 1
fi
echo -e "${GREEN}✓ Disk space sufficient (${AVAILABLE_GB}GB available, ~${REQUIRED_GB}GB needed)${NC}"

# Step 3: Check/Enable extensions
echo -e "${BLUE}[3/8]${NC} Checking required extensions..."
PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<EOF
-- Enable pg_stat_statements (requires superuser)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT 'pg_stat_statements enabled' as status;
EOF
echo -e "${GREEN}✓ Extensions configured${NC}"

# Step 4: Create database
echo -e "${BLUE}[4/8]${NC} Creating performance database..."
if PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  echo -e "${YELLOW}⚠ Database '$DB_NAME' already exists${NC}"
  read -p "  Drop and recreate? (yes/no): " CONFIRM
  if [[ "$CONFIRM" == "yes" ]]; then
    PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
    echo -e "${GREEN}✓ Dropped existing database${NC}"
  else
    echo -e "${YELLOW}⚠ Using existing database${NC}"
    DB_EXISTS=true
  fi
fi

if [[ "${DB_EXISTS:-false}" != "true" ]]; then
  PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<EOF
CREATE DATABASE $DB_NAME
  WITH OWNER = $ADMIN_USER
       ENCODING = 'UTF8'
       LC_COLLATE = 'en_US.UTF-8'
       LC_CTYPE = 'en_US.UTF-8'
       TEMPLATE = template0;

-- Set performance parameters
ALTER DATABASE $DB_NAME SET work_mem = '$WORK_MEM';
ALTER DATABASE $DB_NAME SET maintenance_work_mem = '$MAINTENANCE_WORK_MEM';
ALTER DATABASE $DB_NAME SET shared_buffers = '$SHARED_BUFFERS';
ALTER DATABASE $DB_NAME SET effective_cache_size = '4GB';
ALTER DATABASE $DB_NAME SET random_page_cost = 1.1;

-- Autovacuum tuning for high-churn tables
ALTER DATABASE $DB_NAME SET autovacuum_vacuum_scale_factor = 0.05;
ALTER DATABASE $DB_NAME SET autovacuum_analyze_scale_factor = 0.02;
ALTER DATABASE $DB_NAME SET autovacuum_vacuum_cost_limit = 2000;

-- Logging for slow queries
ALTER DATABASE $DB_NAME SET log_min_duration_statement = 1000;
ALTER DATABASE $DB_NAME SET log_statement = 'ddl';
ALTER DATABASE $DB_NAME SET log_checkpoints = on;
ALTER DATABASE $DB_NAME SET log_autovacuum_min_duration = 0;

SELECT 'Database created' as status;
EOF
  echo -e "${GREEN}✓ Database '$DB_NAME' created${NC}"
fi

# Step 5: Create dedicated user
echo -e "${BLUE}[5/8]${NC} Creating dedicated user with least privilege..."
PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<EOF
-- Drop user if exists
DROP USER IF EXISTS $DB_USER;

-- Create user with limited privileges
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';

-- Grant database connection
GRANT CONNECT ON DATABASE $DB_NAME TO $DB_USER;

-- Grant schema privileges
\c $DB_NAME
GRANT USAGE ON SCHEMA public TO $DB_USER;
GRANT CREATE ON SCHEMA public TO $DB_USER;

-- Grant table privileges (will apply to future tables via default)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $DB_USER;

SELECT 'User created' as status;
EOF
echo -e "${GREEN}✓ User '$DB_USER' created with least privilege${NC}"

# Step 6: Run Prisma migrations
echo -e "${BLUE}[6/8]${NC} Running Prisma migrations..."
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${ADMIN_HOST}:${ADMIN_PORT}/${DB_NAME}?schema=public"

cd "$(dirname "$0")/../.."
if [[ -f "prisma/schema.prisma" ]]; then
  npx prisma migrate deploy
  echo -e "${GREEN}✓ Migrations applied${NC}"
else
  echo -e "${YELLOW}⚠ No Prisma schema found, skipping migrations${NC}"
fi

# Step 7: Enable pg_stat_statements for database
echo -e "${BLUE}[7/8]${NC} Enabling query monitoring..."
PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d "$DB_NAME" <<EOF
-- Enable extension in target database
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Reset statistics
SELECT pg_stat_statements_reset();

SELECT 'Query monitoring enabled' as status;
EOF
echo -e "${GREEN}✓ Query monitoring enabled${NC}"

# Step 8: Write credentials and connection info
echo -e "${BLUE}[8/8]${NC} Writing configuration files..."

# Create secrets directory
mkdir -p "$(dirname "$0")/../../.secrets"
SECRETS_DIR="$(dirname "$0")/../../.secrets"

# Write environment file
cat > "$SECRETS_DIR/.env.${ENV}" <<EOF
# Performance Database Credentials - ${ENV^^} Environment
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# WARNING: Keep this file secure. Do NOT commit to version control.

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${ADMIN_HOST}:${ADMIN_PORT}/${DB_NAME}?schema=public"

# Connection details
PERF_DB_HOST="${ADMIN_HOST}"
PERF_DB_PORT="${ADMIN_PORT}"
PERF_DB_NAME="${DB_NAME}"
PERF_DB_USER="${DB_USER}"
PERF_DB_PASS="${DB_PASS}"

# Environment metadata
PERF_ENV="${ENV}"
TARGET_MESSAGES="${TARGET_MESSAGES}"
TARGET_USERS="${TARGET_USERS}"
EOF

chmod 600 "$SECRETS_DIR/.env.${ENV}"
echo -e "${GREEN}✓ Credentials written to .secrets/.env.${ENV}${NC}"

# Write connection helper script
cat > "$SECRETS_DIR/connect-${ENV}.sh" <<EOF
#!/bin/bash
# Quick connect script for ${ENV} environment
export PGPASSWORD="${DB_PASS}"
psql -h "${ADMIN_HOST}" -p "${ADMIN_PORT}" -U "${DB_USER}" -d "${DB_NAME}" "\$@"
EOF

chmod 700 "$SECRETS_DIR/connect-${ENV}.sh"

# Write monitoring queries
cat > "$SECRETS_DIR/monitor-${ENV}.sql" <<EOF
-- Performance Database Monitoring Queries
-- Environment: ${ENV^^}
-- Database: ${DB_NAME}

-- Query 1: Top slow queries
SELECT 
  query,
  calls,
  mean_exec_time,
  total_exec_time,
  rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Query 2: Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) AS bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY bytes DESC;

-- Query 3: Index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- Query 4: Autovacuum activity
SELECT
  schemaname,
  relname,
  last_vacuum,
  last_autovacuum,
  vacuum_count,
  autovacuum_count,
  n_tup_ins,
  n_tup_upd,
  n_tup_del
FROM pg_stat_user_tables
ORDER BY autovacuum_count DESC;
EOF

echo -e "${GREEN}✓ Monitoring queries written to .secrets/monitor-${ENV}.sql${NC}"

# Print summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Provisioning Complete${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Database Connection:${NC}"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Host: $ADMIN_HOST:$ADMIN_PORT"
echo "  Password: [saved in .secrets/.env.${ENV}]"
echo ""
echo -e "${GREEN}Configuration Files:${NC}"
echo "  Environment: .secrets/.env.${ENV}"
echo "  Connect Script: .secrets/connect-${ENV}.sh"
echo "  Monitor Queries: .secrets/monitor-${ENV}.sql"
echo ""
echo -e "${GREEN}Quick Start:${NC}"
echo "  # Load environment variables"
echo "  source .secrets/.env.${ENV}"
echo ""
echo "  # Connect to database"
echo "  .secrets/connect-${ENV}.sh"
echo ""
echo "  # Run monitoring queries"
echo "  .secrets/connect-${ENV}.sh -f .secrets/monitor-${ENV}.sql"
echo ""
echo "  # Generate synthetic data"
echo "  cd scripts/synthetic-data"
echo "  NODE_OPTIONS=\"--max-old-space-size=4096\" npx ts-node quick-generator.ts"
echo ""
echo -e "${YELLOW}Security Notes:${NC}"
echo "  • Credentials stored in .secrets/ (gitignored)"
echo "  • User has least privilege (no superuser)"
echo "  • pg_stat_statements enabled for query monitoring"
echo "  • Autovacuum tuned for high-churn workloads"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Generate synthetic data (500K-300M messages)"
echo "  2. Run dataset validation (validate-dataset-fidelity.ts)"
echo "  3. Capture baseline query plans (verify-index-performance.ts)"
echo "  4. Apply Phase 2 indexes"
echo "  5. Measure improvements"
echo ""
