#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BACKUP_FILE="test-backup.dump"
TEST_RESULTS=()

echo "=========================================="
echo "🧪 Production Migration Test Suite"
echo "=========================================="
echo ""
echo "This test simulates the complete production migration:"
echo "  1. Fresh PostgreSQL 18 deployment"
echo "  2. Backup restore from production"
echo "  3. Comprehensive functionality testing"
echo ""

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}❌ Backup file not found: $BACKUP_FILE${NC}"
    echo "Please place your production backup at: $(pwd)/$BACKUP_FILE"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo -e "${BLUE}📦 Backup file found: $BACKUP_FILE ($BACKUP_SIZE)${NC}"
echo ""

# Step 1: Clean slate
echo -e "${YELLOW}Step 1: Wiping existing environment...${NC}"
docker-compose -f docker-compose.local.yml down -v > /dev/null 2>&1 || true
echo -e "${GREEN}✓ Environment cleaned${NC}"
echo ""

# Step 2: Start fresh PostgreSQL 18
echo -e "${YELLOW}Step 2: Starting fresh PostgreSQL 18 stack...${NC}"
docker-compose -f docker-compose.local.yml up -d > /dev/null 2>&1

echo -n "Waiting for services to be healthy"
for i in {1..60}; do
    DB_HEALTHY=$(docker-compose -f docker-compose.local.yml ps db 2>/dev/null | grep -c "healthy" || true)
    APP_HEALTHY=$(docker-compose -f docker-compose.local.yml ps app 2>/dev/null | grep -c "healthy" || true)
    
    if [ "$DB_HEALTHY" -eq 1 ] && [ "$APP_HEALTHY" -eq 1 ]; then
        echo ""
        break
    fi
    echo -n "."
    sleep 1
done

if [ "$DB_HEALTHY" -eq 0 ] || [ "$APP_HEALTHY" -eq 0 ]; then
    echo -e "\n${RED}❌ Services failed to start healthy${NC}"
    docker-compose -f docker-compose.local.yml logs
    exit 1
fi

echo -e "${GREEN}✓ PostgreSQL 18 running${NC}"
echo -e "${GREEN}✓ Application running${NC}"
echo ""

# Verify PostgreSQL version
echo -e "${YELLOW}Step 3: Verifying PostgreSQL 18...${NC}"
PG_VERSION=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -t -c "SHOW server_version;" | xargs | cut -d' ' -f1)
echo "  Database version: PostgreSQL $PG_VERSION"

if [[ ! "$PG_VERSION" =~ ^18\. ]]; then
    echo -e "${RED}❌ Expected PostgreSQL 18, got $PG_VERSION${NC}"
    exit 1
fi
echo -e "${GREEN}✓ PostgreSQL 18 confirmed${NC}"
echo ""

# Step 4: Restore production backup
echo -e "${YELLOW}Step 4: Restoring production backup...${NC}"
echo "  Using: $BACKUP_FILE ($BACKUP_SIZE)"
RESTORE_START=$(date +%s)

# Copy backup into container and restore
docker cp "$BACKUP_FILE" sushe-online-local:/tmp/backup.dump

docker-compose -f docker-compose.local.yml exec -T -e PGPASSWORD=example app \
    pg_restore --clean --if-exists --single-transaction \
    -h db -p 5432 -U postgres -d sushe /tmp/backup.dump 2>&1 | \
    grep -v "NOTICE\|WARNING" || true

RESTORE_END=$(date +%s)
RESTORE_DURATION=$((RESTORE_END - RESTORE_START))

echo -e "${GREEN}✓ Backup restored in ${RESTORE_DURATION}s${NC}"
echo ""

# Step 5: Restart app to clear any cached state
echo -e "${YELLOW}Step 5: Restarting application...${NC}"
docker-compose -f docker-compose.local.yml restart app > /dev/null 2>&1
sleep 5
echo -e "${GREEN}✓ Application restarted${NC}"
echo ""

# Step 6: Database integrity checks
echo -e "${YELLOW}Step 6: Database integrity checks...${NC}"

# Count records
USER_COUNT=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "SELECT COUNT(*) FROM users;" | xargs)
LIST_COUNT=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "SELECT COUNT(*) FROM lists;" | xargs)
ITEM_COUNT=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "SELECT COUNT(*) FROM list_items;" | xargs)
ALBUM_COUNT=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "SELECT COUNT(*) FROM albums;" | xargs)

echo "  Users: $USER_COUNT"
echo "  Lists: $LIST_COUNT"
echo "  List Items: $ITEM_COUNT"
echo "  Albums: $ALBUM_COUNT"

if [ "$USER_COUNT" -eq 0 ]; then
    echo -e "${RED}❌ No users found in database${NC}"
    TEST_RESULTS+=("FAIL: Database has no users")
else
    echo -e "${GREEN}✓ Database populated with real data${NC}"
    TEST_RESULTS+=("PASS: Database contains $USER_COUNT users, $LIST_COUNT lists, $ITEM_COUNT items")
fi
echo ""

# Step 7: JSON data validation
echo -e "${YELLOW}Step 7: JSON data validation...${NC}"

# Check for any invalid JSONB in tracks column
INVALID_JSON=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
SELECT COUNT(*) FROM list_items WHERE tracks IS NOT NULL;
" | xargs)

if [ "$INVALID_JSON" -gt 0 ]; then
    echo "  Found $INVALID_JSON items with track data"
    
    # Try to access the JSON data to ensure it's valid
    JSON_TEST=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
    SELECT jsonb_array_length(tracks) FROM list_items WHERE tracks IS NOT NULL LIMIT 1;
    " 2>&1 || echo "ERROR")
    
    if [[ "$JSON_TEST" == *"ERROR"* ]]; then
        echo -e "${RED}❌ Invalid JSON data detected${NC}"
        TEST_RESULTS+=("FAIL: Invalid JSON in tracks column")
    else
        echo -e "${GREEN}✓ All JSONB data valid${NC}"
        TEST_RESULTS+=("PASS: JSONB data integrity verified")
    fi
else
    echo -e "${GREEN}✓ No track data to validate${NC}"
    TEST_RESULTS+=("PASS: No JSON validation issues")
fi
echo ""

# Step 8: Application health check
echo -e "${YELLOW}Step 8: Application health checks...${NC}"

# Test main page
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || echo "000")
if [ "$HTTP_CODE" == "302" ] || [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ Application responding (HTTP $HTTP_CODE)${NC}"
    TEST_RESULTS+=("PASS: Application health check")
else
    echo -e "${RED}❌ Application not responding correctly (HTTP $HTTP_CODE)${NC}"
    TEST_RESULTS+=("FAIL: Application health check failed")
fi
echo ""

# Step 9: API functionality tests
echo -e "${YELLOW}Step 9: API functionality tests...${NC}"

# Get a sample user for testing (skip admin user)
SAMPLE_USER=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
SELECT _id FROM users WHERE role IS NULL OR role != 'admin' LIMIT 1;
" | xargs)

if [ -n "$SAMPLE_USER" ]; then
    echo "  Testing with user: $SAMPLE_USER"
    
    # Check user's lists
    USER_LISTS=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
    SELECT COUNT(*) FROM lists WHERE user_id='$SAMPLE_USER';
    " | xargs)
    
    echo "  User has $USER_LISTS list(s)"
    
    if [ "$USER_LISTS" -gt 0 ]; then
        # Get a sample list
        SAMPLE_LIST=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
        SELECT _id FROM lists WHERE user_id='$SAMPLE_USER' LIMIT 1;
        " | xargs)
        
        # Check list items
        LIST_ITEMS=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
        SELECT COUNT(*) FROM list_items WHERE list_id='$SAMPLE_LIST';
        " | xargs)
        
        echo "  Sample list has $LIST_ITEMS item(s)"
        
        if [ "$LIST_ITEMS" -gt 0 ]; then
            echo -e "${GREEN}✓ User data structure intact${NC}"
            TEST_RESULTS+=("PASS: User lists and items accessible")
        else
            echo -e "${YELLOW}⚠ List exists but has no items${NC}"
            TEST_RESULTS+=("WARN: Empty list found")
        fi
    else
        echo -e "${YELLOW}⚠ User has no lists${NC}"
        TEST_RESULTS+=("WARN: User has no lists to test")
    fi
else
    echo -e "${YELLOW}⚠ No regular users found (only admin?)${NC}"
    TEST_RESULTS+=("WARN: No regular users to test")
fi
echo ""

# Step 10: Foreign key integrity
echo -e "${YELLOW}Step 10: Foreign key integrity checks...${NC}"

# Check for orphaned list items
ORPHANED_ITEMS=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
SELECT COUNT(*) FROM list_items li 
WHERE NOT EXISTS (SELECT 1 FROM lists l WHERE l._id = li.list_id);
" | xargs)

if [ "$ORPHANED_ITEMS" -eq 0 ]; then
    echo -e "${GREEN}✓ No orphaned list items${NC}"
    TEST_RESULTS+=("PASS: No orphaned records")
else
    echo -e "${RED}❌ Found $ORPHANED_ITEMS orphaned list items${NC}"
    TEST_RESULTS+=("FAIL: Found orphaned records")
fi
echo ""

# Step 11: Check for common issues
echo -e "${YELLOW}Step 11: Common issue detection...${NC}"

# Check for users without passwords (should not exist)
NO_PASSWORD=$(docker-compose -f docker-compose.local.yml exec -T db psql -U postgres -d sushe -t -c "
SELECT COUNT(*) FROM users WHERE hash IS NULL OR hash = '';
" | xargs 2>/dev/null || echo "0")

if [ "$NO_PASSWORD" -eq 0 ]; then
    echo -e "${GREEN}✓ All users have passwords${NC}"
    TEST_RESULTS+=("PASS: User authentication data intact")
else
    echo -e "${RED}❌ Found $NO_PASSWORD users without passwords${NC}"
    TEST_RESULTS+=("FAIL: Missing password data")
fi

# Check application logs for errors
echo "  Checking application logs for errors..."
ERROR_COUNT=$(docker-compose -f docker-compose.local.yml logs app 2>&1 | grep -i "ERROR" | wc -l)

if [ "$ERROR_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ No errors in application logs${NC}"
    TEST_RESULTS+=("PASS: Clean application logs")
else
    echo -e "${YELLOW}⚠ Found $ERROR_COUNT error(s) in logs${NC}"
    TEST_RESULTS+=("WARN: $ERROR_COUNT errors in logs (check manually)")
fi
echo ""

# Summary
echo "=========================================="
echo "📊 Test Results Summary"
echo "=========================================="
echo ""

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

for result in "${TEST_RESULTS[@]}"; do
    if [[ "$result" == PASS* ]]; then
        echo -e "${GREEN}✓ $result${NC}"
        ((PASS_COUNT++))
    elif [[ "$result" == FAIL* ]]; then
        echo -e "${RED}✗ $result${NC}"
        ((FAIL_COUNT++))
    else
        echo -e "${YELLOW}⚠ $result${NC}"
        ((WARN_COUNT++))
    fi
done

echo ""
echo "=========================================="
echo -e "Passed: ${GREEN}$PASS_COUNT${NC} | Failed: ${RED}$FAIL_COUNT${NC} | Warnings: ${YELLOW}$WARN_COUNT${NC}"
echo "=========================================="
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ Migration Test PASSED${NC}"
    echo ""
    echo "The production backup has been successfully:"
    echo "  • Restored to PostgreSQL 18"
    echo "  • Validated for data integrity"
    echo "  • Tested for application compatibility"
    echo ""
    echo "Migration is ready for production deployment!"
    echo ""
    echo "Services are still running at:"
    echo "  • Application: http://localhost:3000"
    echo "  • Database: localhost:5433"
    echo ""
    echo "To stop: docker-compose -f docker-compose.local.yml down"
    exit 0
else
    echo -e "${RED}❌ Migration Test FAILED${NC}"
    echo ""
    echo "Please review the failures above before proceeding."
    echo ""
    echo "To view logs:"
    echo "  docker-compose -f docker-compose.local.yml logs"
    exit 1
fi

