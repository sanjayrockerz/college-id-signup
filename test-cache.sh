#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Cache Behavior Test Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Wait for application to be ready
echo -e "${BLUE}Checking if application is running...${NC}"
MAX_RETRIES=10
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s http://localhost:3001/api/v1/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Application is running${NC}"
        break
    fi
    echo "Waiting for application to start... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}✗ Application not responding after $MAX_RETRIES attempts${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Step 1: Check Cache Health${NC}"
echo -e "${BLUE}========================================${NC}"
curl -s http://localhost:3001/api/v1/health/cache | jq .
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Step 2: Check Overall Health (with cache metrics)${NC}"
echo -e "${BLUE}========================================${NC}"
curl -s http://localhost:3001/api/v1/health | jq .
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Cache tests completed!${NC}"
echo -e "${GREEN}========================================${NC}"
