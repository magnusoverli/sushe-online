# PostgreSQL 18 Migration Guide

## Overview

This branch migrates the application from:
- **Node.js**: `node:24-alpine` → `node:24-slim` (Debian)
- **PostgreSQL**: v17 → v18
- **Architecture**: Docker exec approach → Direct TCP connections
- **Security**: Root user → node user (proper privilege separation)

## Changes Made

### 1. Dockerfile
- Switched from Alpine Linux to Debian Slim base image
- Installed PostgreSQL 18 client from PGDG repository
- Removed `docker-cli` dependency
- Enabled proper `node` user (no longer running as root)

### 2. docker-compose.yml
- Updated database image: `postgres:17` → `postgres:18`
- Removed Docker socket mount (`/var/run/docker.sock`)
- Removed `user: root` directive (now runs as node user)

### 3. routes/admin.js
- Updated default `PG_MAJOR` from 16 → 18
- Replaced `docker exec` approach with direct TCP connections
- Uses environment variables (PGHOST, PGPORT, etc.) for DB access
- Backup/restore now connects to `db` service via Docker network

## Testing Locally

### Build and test the new setup:

```bash
# Build the new image
docker-compose -f docker-compose.local.yml build

# Start the services
docker-compose -f docker-compose.local.yml up -d

# Check logs
docker-compose -f docker-compose.local.yml logs -f app

# Verify PostgreSQL version
docker-compose -f docker-compose.local.yml exec db psql -U postgres -d sushe -c "SELECT version();"

# Test backup functionality
# Login as admin and try creating a backup at /admin

# Clean up when done
docker-compose -f docker-compose.local.yml down -v
```

## Production Migration Strategy

### Option 1: Export/Import (Recommended)

1. **Backup current production data:**
   ```bash
   # Use the admin interface to download a backup
   # Or use docker exec on current production:
   docker exec sushe-online-db-1 pg_dump -Fc -U postgres -d sushe > production-backup.dump
   ```

2. **Deploy new infrastructure:**
   - Push this branch to main
   - Let CI/CD build and deploy the new containers
   - Fresh PostgreSQL 18 database will be initialized

3. **Restore data:**
   - Use the admin restore interface to upload the backup
   - Or manually restore:
   ```bash
   docker exec -i sushe-online pg_restore --clean --if-exists -U postgres -d sushe < production-backup.dump
   ```

### Option 2: In-place Upgrade (Advanced)

The `docker-entrypoint-upgrade.sh` script supports PostgreSQL 17→18 upgrades:
1. It detects PostgreSQL 17 data
2. Installs PostgreSQL 17 binaries
3. Runs `pg_upgrade` to migrate to PostgreSQL 18
4. Cleans up old binaries

**Note:** This was designed for the docker exec architecture. May need adjustments for the new setup.

## Verification Checklist

- [ ] Application starts successfully
- [ ] Database connections work
- [ ] User authentication works
- [ ] Admin backup creation works
- [ ] Admin restore works
- [ ] All tests pass: `npm test`
- [ ] Image size is acceptable (~70MB vs ~45MB Alpine)

## Benefits

✅ **Version consistency**: PostgreSQL 18 client + server (no version mismatch)  
✅ **Better security**: Runs as node user, no Docker socket access  
✅ **Simpler architecture**: No docker CLI dependency  
✅ **Better compatibility**: Debian glibc vs Alpine musl (better for native modules)  
✅ **Standard approach**: Direct database connections instead of docker exec

## Rollback Plan

If issues arise:
```bash
git checkout main
docker-compose pull  # Get the old images
docker-compose up -d
```

Then restore data from the backup taken in step 1.

## Notes

- The new setup uses TCP connections over the Docker network
- PostgreSQL credentials are passed via environment variables
- The `postgres-socket` volume is still mounted but connection is via TCP
- Image size increases by ~25MB (70MB vs 45MB), acceptable tradeoff

