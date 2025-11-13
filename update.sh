#!/bin/bash



set -e

echo "🎸 Updating SuShe Online..."
echo ""


echo "📦 Pulling latest image from GitHub Container Registry..."
docker compose pull app


echo "🔄 Recreating app container..."
docker compose up -d app


echo "🏥 Checking application health..."
sleep 5

if docker compose ps app | grep -q "Up"; then
    echo ""
    echo "✅ SuShe Online updated successfully!"
    echo ""
    echo "View logs with: docker compose logs -f app"
else
    echo ""
    echo "⚠️  Warning: Container may not be running properly"
    echo "Check logs with: docker compose logs app"
    exit 1
fi

