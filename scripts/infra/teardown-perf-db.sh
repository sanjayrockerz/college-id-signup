#!/bin/bash
# Performance Database Teardown Script
# 
# Purpose: Safely decommission performance test environments and purge all data
# Owner: DevOps/SRE + Security Officer
# Version: 1.0.0
#
# Usage:
#   ./teardown-perf-db.sh --env [dev|staging|perf] --confirm
#
# Safety:
#   - Requires explicit --confirm flag to prevent accidents
#   - Validates environment exists before deletion
#   - Purges all data, users, and credentials
#   - Logs all actions for audit trail

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
ENV=""
CONFIRM=false
ADMIN_HOST="${POSTGRES_HOST:-localhost}"
ADMIN_PORT="${POSTGRES_PORT:-5432}"
ADMIN_USER="${POSTGRES_ADMIN_USER:-postgres}"
ADMIN_PASS="${POSTGRES_ADMIN_PASS:-password}"

AUDIT_LOG="$(dirname "$0")/../../.secrets/teardown-audit.log"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV="$2"
      shift 2
      ;;
    --confirm)
      CONFIRM=true
      shift
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
      echo "Usage: $0 --env [dev|staging|perf] --confirm [--host HOST] [--port PORT]"
      echo ""
      echo "Options:"
      echo "  --env ENV      Environment: dev, staging, or perf (required)"
      echo "  --confirm      Required confirmation flag (prevents accidents)"
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
  echo "Usage: $0 --env [dev|staging|perf] --confirm"
  exit 1
fi

if [[ ! "$ENV" =~ ^(dev|staging|perf)$ ]]; then
  echo -e "${RED}ERROR: --env must be dev, staging, or perf${NC}"
  exit 1
fi

if [[ "$CONFIRM" != true ]]; then
  echo -e "${RED}ERROR: --confirm flag is required for safety${NC}"
  echo ""
  echo -e "${YELLOW}This operation will:${NC}"
  echo "  • DELETE all data in the $ENV environment"
  echo "  • REMOVE database and users"
  echo "  • PURGE credentials from .secrets/"
  echo ""
  echo "To proceed, add --confirm flag:"
  echo "  $0 --env $ENV --confirm"
  exit 1
fi

# Configuration per environment
case $ENV in
  dev)
    DB_NAME="chat_perf_dev"
    DB_USER="perf_dev_user"
    ;;
  staging)
    DB_NAME="chat_perf_staging"
    DB_USER="perf_staging_user"
    ;;
  perf)
    DB_NAME="chat_perf"
    DB_USER="perf_user"
    ;;
esac

# Audit logging function
log_audit() {
  mkdir -p "$(dirname "$AUDIT_LOG")"
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $1" | tee -a "$AUDIT_LOG"
}

echo -e "${RED}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${RED}║  PERFORMANCE DATABASE TEARDOWN                ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}WARNING: You are about to PERMANENTLY DELETE:${NC}"
echo "  Environment: $ENV"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Host: $ADMIN_HOST:$ADMIN_PORT"
echo ""
read -p "Type '$ENV' to confirm deletion: " CONFIRMATION

if [[ "$CONFIRMATION" != "$ENV" ]]; then
  echo -e "${RED}Confirmation failed. Aborting.${NC}"
  exit 1
fi

log_audit "TEARDOWN INITIATED - Environment: $ENV, Database: $DB_NAME, Operator: $(whoami)"

echo ""
echo -e "${BLUE}[Step 1/5] Checking environment exists...${NC}"

# Check if database exists
DB_EXISTS=$(PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';" || echo "0")

if [[ "$DB_EXISTS" != "1" ]]; then
  echo -e "${YELLOW}⚠ Database $DB_NAME does not exist${NC}"
  log_audit "Database $DB_NAME not found - may already be deleted"
else
  echo -e "${GREEN}✓ Database $DB_NAME found${NC}"
fi

echo ""
echo -e "${BLUE}[Step 2/5] Terminating active connections...${NC}"

if [[ "$DB_EXISTS" == "1" ]]; then
  PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<SQL
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
SQL
  echo -e "${GREEN}✓ Active connections terminated${NC}"
  log_audit "Terminated active connections to $DB_NAME"
else
  echo -e "${YELLOW}⚠ Skipping - database does not exist${NC}"
fi

echo ""
echo -e "${BLUE}[Step 3/5] Dropping database...${NC}"

if [[ "$DB_EXISTS" == "1" ]]; then
  PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<SQL
    DROP DATABASE IF EXISTS $DB_NAME;
SQL
  echo -e "${GREEN}✓ Database $DB_NAME dropped${NC}"
  log_audit "Database $DB_NAME DELETED"
else
  echo -e "${YELLOW}⚠ Skipping - database does not exist${NC}"
fi

echo ""
echo -e "${BLUE}[Step 4/5] Removing database user...${NC}"

USER_EXISTS=$(PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER';" || echo "0")

if [[ "$USER_EXISTS" == "1" ]]; then
  PGPASSWORD="$ADMIN_PASS" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<SQL
    DROP USER IF EXISTS $DB_USER;
SQL
  echo -e "${GREEN}✓ User $DB_USER dropped${NC}"
  log_audit "User $DB_USER DELETED"
else
  echo -e "${YELLOW}⚠ User $DB_USER does not exist${NC}"
fi

echo ""
echo -e "${BLUE}[Step 5/5] Purging credentials and artifacts...${NC}"

SECRETS_DIR="$(dirname "$0")/../../.secrets"
FILES_DELETED=0

# Delete environment files
if [[ -f "$SECRETS_DIR/.env.$ENV" ]]; then
  rm -f "$SECRETS_DIR/.env.$ENV"
  echo -e "${GREEN}✓ Deleted .env.$ENV${NC}"
  log_audit "Deleted credential file: .env.$ENV"
  ((FILES_DELETED++))
fi

# Delete connect script
if [[ -f "$SECRETS_DIR/connect-$ENV.sh" ]]; then
  rm -f "$SECRETS_DIR/connect-$ENV.sh"
  echo -e "${GREEN}✓ Deleted connect-$ENV.sh${NC}"
  log_audit "Deleted connect script: connect-$ENV.sh"
  ((FILES_DELETED++))
fi

# Delete monitoring queries
if [[ -f "$SECRETS_DIR/monitor-$ENV.sql" ]]; then
  rm -f "$SECRETS_DIR/monitor-$ENV.sql"
  echo -e "${GREEN}✓ Deleted monitor-$ENV.sql${NC}"
  log_audit "Deleted monitoring queries: monitor-$ENV.sql"
  ((FILES_DELETED++))
fi

if [[ $FILES_DELETED -eq 0 ]]; then
  echo -e "${YELLOW}⚠ No credential files found to delete${NC}"
else
  echo -e "${GREEN}✓ Purged $FILES_DELETED credential file(s)${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  TEARDOWN COMPLETE                            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo "Environment: $ENV"
echo "Database: $DB_NAME (DELETED)"
echo "User: $DB_USER (DELETED)"
echo "Credentials: PURGED"
echo ""
echo -e "${BLUE}Audit trail:${NC}"
echo "  $AUDIT_LOG"
echo ""

log_audit "TEARDOWN COMPLETE - Environment: $ENV"

# Summary for compliance
echo -e "${BLUE}Compliance Summary:${NC}"
echo "  • All data permanently deleted"
echo "  • Database and users removed from PostgreSQL"
echo "  • Credentials purged from filesystem"
echo "  • Actions logged to audit trail"
echo "  • No recovery possible (intended)"
echo ""
