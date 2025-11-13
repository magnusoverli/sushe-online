#!/bin/bash







set -e

ICON_DIR="public/icons/ios"
ANDROID_DIR="public/icons/android"

echo "🎨 Icon Optimization Script"
echo "=============================="


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


ESSENTIAL_SIZES=(180 192 512)
echo "📱 Optimizing iOS icons..."

for file in "$ICON_DIR"/*.png; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        size="${filename%.*}"
        
        
        is_essential=false
        for essential in "${ESSENTIAL_SIZES[@]}"; do
            if [[ "$filename" == *"$essential"* ]]; then
                is_essential=true
                break
            fi
        done
        
        if [ "$is_essential" = true ]; then
            
            if command -v pngquant &> /dev/null; then
                pngquant --quality=65-80 --skip-if-larger --force --output "$file" "$file" 2>/dev/null || true
                echo "  ✓ Optimized $filename"
            fi
            
            
            cwebp -q 80 "$file" -o "${file%.*}.webp" &>/dev/null
            echo "  ✓ Created ${filename%.*}.webp"
        else
            
            echo "  🗑️  Removed non-essential $filename"
            rm "$file"
        fi
    fi
done


echo ""
echo "🤖 Optimizing Android icons..."

for file in "$ANDROID_DIR"/*.png; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        
        
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
