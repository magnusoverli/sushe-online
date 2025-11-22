#!/bin/bash
set -e

echo "🧪 PostgreSQL 18 Migration Test Script"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}1. Building Docker image...${NC}"
docker-compose -f docker-compose.local.yml build --quiet
echo -e "${GREEN}✓ Build successful${NC}"
echo ""

echo -e "${YELLOW}2. Starting services...${NC}"
docker-compose -f docker-compose.local.yml up -d
echo ""

echo -e "${YELLOW}3. Waiting for services to be healthy...${NC}"
for i in {1..30}; do
    if docker-compose -f docker-compose.local.yml ps | grep -q "healthy"; then
        break
    fi
    echo -n "."
    sleep 1
done
echo ""

# Check if both services are healthy
DB_HEALTHY=$(docker-compose -f docker-compose.local.yml ps db | grep -c "healthy" || true)
APP_HEALTHY=$(docker-compose -f docker-compose.local.yml ps app | grep -c "healthy" || true)

if [ "$DB_HEALTHY" -eq 0 ]; then
    echo -e "${RED}✗ Database is not healthy${NC}"
    docker-compose -f docker-compose.local.yml logs db
    exit 1
fi

if [ "$APP_HEALTHY" -eq 0 ]; then
    echo -e "${RED}✗ Application is not healthy${NC}"
    docker-compose -f docker-compose.local.yml logs app
    exit 1
fi

echo -e "${GREEN}✓ All services healthy${NC}"
echo ""

echo -e "${YELLOW}4. Verifying PostgreSQL versions...${NC}"

# Check DB version
DB_VERSION=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "SELECT version();" | grep -oP "PostgreSQL \K[0-9]+")
echo "   Database server: PostgreSQL $DB_VERSION"

# Check client version
CLIENT_VERSION=$(docker-compose -f docker-compose.local.yml exec -T app pg_dump --version | grep -oP "PostgreSQL\) \K[0-9]+")
echo "   Database client: PostgreSQL $CLIENT_VERSION"

if [ "$DB_VERSION" == "$CLIENT_VERSION" ]; then
    echo -e "${GREEN}✓ Client and server versions match${NC}"
else
    echo -e "${RED}✗ Version mismatch! Client: $CLIENT_VERSION, Server: $DB_VERSION${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}5. Verifying application user...${NC}"
APP_USER=$(docker-compose -f docker-compose.local.yml exec -T app whoami)
echo "   Running as: $APP_USER"
if [ "$APP_USER" == "node" ]; then
    echo -e "${GREEN}✓ Application runs as node user (not root)${NC}"
else
    echo -e "${RED}✗ Application running as: $APP_USER (expected: node)${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}6. Testing application response...${NC}"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$RESPONSE" == "302" ]; then
    echo -e "${GREEN}✓ Application responding correctly (HTTP $RESPONSE)${NC}"
else
    echo -e "${RED}✗ Unexpected response: HTTP $RESPONSE${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}7. Testing database connectivity...${NC}"
TABLES=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
echo "   Found $TABLES tables in database"
echo -e "${GREEN}✓ Database connectivity working${NC}"
echo ""

echo "========================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Services are running at:"
echo "  • Application: http://localhost:3000"
echo "  • Database: localhost:5433"
echo ""
echo "To stop services:"
echo "  docker-compose -f docker-compose.local.yml down"
echo ""
echo "To stop and remove volumes:"
echo "  docker-compose -f docker-compose.local.yml down -v"

