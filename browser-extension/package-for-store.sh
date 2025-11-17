#!/bin/bash
# Package SuShe Online Extension for Chrome Web Store Submission

set -e

echo "📦 Packaging SuShe Online Extension for Chrome Web Store..."
echo ""

# Navigate to the extension directory
cd "$(dirname "$0")"

# Output file
OUTPUT_FILE="sushe-online-extension.zip"

# Remove old package if it exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "🗑️  Removing old package..."
    rm "$OUTPUT_FILE"
fi

echo "📋 Including files:"
echo "  ✓ manifest.json"
echo "  ✓ background.js"
echo "  ✓ content-script.js"
echo "  ✓ auth-listener.js"
echo "  ✓ options.html"
echo "  ✓ options.js"
echo "  ✓ popup.html"
echo "  ✓ popup.js"
echo "  ✓ icons/"
echo ""

# Create the ZIP file with only the necessary files
zip -q "$OUTPUT_FILE" \
    manifest.json \
    background.js \
    content-script.js \
    auth-listener.js \
    options.html \
    options.js \
    popup.html \
    popup.js \
    icons/*.png

echo "✅ Package created: $OUTPUT_FILE"
echo ""

# Show file size
FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo "📊 Package size: $FILE_SIZE"
echo ""

# Test the package
echo "🔍 Verifying package contents..."
zip -sf "$OUTPUT_FILE"
echo ""

echo "✨ Package ready for Chrome Web Store submission!"
echo ""
echo "Next steps:"
echo "1. Go to https://chrome.google.com/webstore/devconsole/"
echo "2. Click 'New Item'"
echo "3. Upload $OUTPUT_FILE"
echo "4. Fill out the store listing (see STORE_LISTING.md)"
echo "5. Submit for review"
echo ""
echo "Good luck! 🚀"

