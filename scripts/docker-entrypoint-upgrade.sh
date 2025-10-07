#!/bin/bash
set -e

PGDATA="/var/lib/postgresql/data"
PG_VERSION_FILE="$PGDATA/PG_VERSION"

echo "🔍 Checking PostgreSQL version..."

if [ -f "$PG_VERSION_FILE" ]; then
    OLD_VERSION=$(cat "$PG_VERSION_FILE")
    echo "   Found PostgreSQL $OLD_VERSION data"
    
    if [ "$OLD_VERSION" = "16" ]; then
        echo ""
        echo "🔄 PostgreSQL 16 → 17 Upgrade Starting"
        echo "========================================"
        echo ""
        
        # Backup old data directory name
        BACKUP_DIR="/var/lib/postgresql/data.pg16.backup"
        NEW_DATA_DIR="/var/lib/postgresql/17/data"
        
        # Clean up any previous failed upgrade attempts
        rm -rf /var/lib/postgresql/17
        rm -rf "$BACKUP_DIR"
        
        echo "📦 Installing PostgreSQL 16 binaries..."
        apt-get update -qq
        apt-get install -y -qq postgresql-16 > /dev/null 2>&1
        echo "   ✅ PostgreSQL 16 binaries installed"
        
        echo ""
        echo "🆕 Creating new PostgreSQL 17 cluster..."
        mkdir -p /var/lib/postgresql/17
        chown -R postgres:postgres /var/lib/postgresql/17
        
        # Initialize new cluster as postgres user
        su - postgres -c "/usr/lib/postgresql/17/bin/initdb -D $NEW_DATA_DIR"
        echo "   ✅ PostgreSQL 17 cluster initialized"
        
        echo ""
        echo "🔍 Running compatibility check..."
        su - postgres -c "cd /var/lib/postgresql && /usr/lib/postgresql/17/bin/pg_upgrade \
            --old-bindir=/usr/lib/postgresql/16/bin \
            --new-bindir=/usr/lib/postgresql/17/bin \
            --old-datadir=$PGDATA \
            --new-datadir=$NEW_DATA_DIR \
            --check"
        echo "   ✅ Compatibility check passed"
        
        echo ""
        echo "⚡ Running pg_upgrade (copying data)..."
        echo "   Note: Using copy mode (not link) for Docker volume compatibility"
        su - postgres -c "cd /var/lib/postgresql && /usr/lib/postgresql/17/bin/pg_upgrade \
            --old-bindir=/usr/lib/postgresql/16/bin \
            --new-bindir=/usr/lib/postgresql/17/bin \
            --old-datadir=$PGDATA \
            --new-datadir=$NEW_DATA_DIR"
        echo "   ✅ Data upgraded successfully"
        
        echo ""
        echo "🔄 Switching to new data directory..."
        # Move old data to backup subdirectory (can't move volume mount point)
        mkdir -p "$PGDATA/pg16_backup"
        find "$PGDATA" -maxdepth 1 -mindepth 1 ! -name 'pg16_backup' -exec mv {} "$PGDATA/pg16_backup/" \;
        
        # Move new data into main directory
        mv "$NEW_DATA_DIR"/* "$PGDATA/"
        rmdir "$NEW_DATA_DIR"
        rm -rf /var/lib/postgresql/17
        
        # Restore important config files
        if [ -f "$PGDATA/pg16_backup/pg_hba.conf" ]; then
            cp "$PGDATA/pg16_backup/pg_hba.conf" "$PGDATA/"
        fi
        if [ -f "$PGDATA/pg16_backup/postgresql.auto.conf" ]; then
            cp "$PGDATA/pg16_backup/postgresql.auto.conf" "$PGDATA/"
        fi
        
        chown -R postgres:postgres "$PGDATA"
        echo "   ✅ Switched to PostgreSQL 17 data"
        echo "   📝 Old data backed up to: $PGDATA/pg16_backup"
        
        echo ""
        echo "🧹 Cleaning up..."
        apt-get remove -y -qq postgresql-16 > /dev/null 2>&1
        apt-get autoremove -y -qq > /dev/null 2>&1
        rm -rf /var/lib/apt/lists/*
        echo "   ✅ Cleanup complete"
        
        echo ""
        echo "========================================"
        echo "✅ PostgreSQL 17 Upgrade Complete!"
        echo "========================================"
        echo ""
        
    elif [ "$OLD_VERSION" = "17" ]; then
        echo "   ✅ Already running PostgreSQL 17, no upgrade needed"
    else
        echo "   ⚠️  Unknown PostgreSQL version: $OLD_VERSION"
        echo "   Proceeding with normal startup..."
    fi
else
    echo "   📝 No existing data found (fresh installation)"
fi

echo ""
echo "🚀 Starting PostgreSQL..."
echo ""

# Execute the original PostgreSQL entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"
