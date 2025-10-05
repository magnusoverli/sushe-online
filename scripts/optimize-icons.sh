#!/bin/bash

# Icon Optimization Script
# This script optimizes PWA icons by converting to WebP and removing unnecessary sizes
# Run this script after installing imagemagick and webp tools:
# - Ubuntu/Debian: sudo apt-get install imagemagick webp
# - macOS: brew install imagemagick webp

set -e

ICON_DIR="public/icons/ios"
ANDROID_DIR="public/icons/android"

echo "🎨 Icon Optimization Script"
echo "=============================="

# Check if required tools are installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Please install it first."
    echo "   Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "   macOS: brew install imagemagick"
    exit 1
fi

if ! command -v cwebp &> /dev/null; then
    echo "❌ WebP tools not found. Please install it first."
    echo "   Ubuntu/Debian: sudo apt-get install webp"
    echo "   macOS: brew install webp"
    exit 1
fi

echo "✅ All required tools found"
echo ""

# Optimize iOS icons - keep only essential sizes
ESSENTIAL_SIZES=(180 192 512)
echo "📱 Optimizing iOS icons..."

for file in "$ICON_DIR"/*.png; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        size="${filename%.*}"
        
        # Check if this is an essential size
        is_essential=false
        for essential in "${ESSENTIAL_SIZES[@]}"; do
            if [[ "$filename" == *"$essential"* ]]; then
                is_essential=true
                break
            fi
        done
        
        if [ "$is_essential" = true ]; then
            # Optimize with pngquant or optipng
            if command -v pngquant &> /dev/null; then
                pngquant --quality=65-80 --skip-if-larger --force --output "$file" "$file" 2>/dev/null || true
                echo "  ✓ Optimized $filename"
            fi
            
            # Create WebP version (smaller file size, modern browsers)
            cwebp -q 80 "$file" -o "${file%.*}.webp" &>/dev/null
            echo "  ✓ Created ${filename%.*}.webp"
        else
            # Remove non-essential sizes to save space
            echo "  🗑️  Removed non-essential $filename"
            rm "$file"
        fi
    fi
done

# Optimize Android icons
echo ""
echo "🤖 Optimizing Android icons..."

for file in "$ANDROID_DIR"/*.png; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        
        # Keep only 192 and 512 for Android
        if [[ "$filename" == *"192"* ]] || [[ "$filename" == *"512"* ]]; then
            if command -v pngquant &> /dev/null; then
                pngquant --quality=65-80 --skip-if-larger --force --output "$file" "$file" 2>/dev/null || true
                echo "  ✓ Optimized $filename"
            fi
            
            cwebp -q 80 "$file" -o "${file%.*}.webp" &>/dev/null
            echo "  ✓ Created ${filename%.*}.webp"
        else
            echo "  🗑️  Removed $filename"
            rm "$file"
        fi
    fi
done

echo ""
echo "✅ Icon optimization complete!"
echo ""
echo "📊 Size comparison:"
du -sh public/icons/
echo ""
echo "💡 Next steps:"
echo "   1. Test the PWA on various devices"
echo "   2. Update manifest.json to use optimized sizes"
echo "   3. Consider using WebP icons for modern browsers"
