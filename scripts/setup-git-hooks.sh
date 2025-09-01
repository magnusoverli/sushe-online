#!/bin/bash

# Setup git hooks for automatic changelog updates

HOOKS_DIR=".git/hooks"
POST_COMMIT_HOOK="$HOOKS_DIR/post-commit"

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Create post-commit hook
cat > "$POST_COMMIT_HOOK" << 'EOF'
#!/bin/bash

# Get the last commit message
COMMIT_MSG=$(git log -1 --pretty=%B)

# Check if commit message indicates a user-facing change
if echo "$COMMIT_MSG" | grep -qE "^(feat|fix|perf|security|ui):" || \
   echo "$COMMIT_MSG" | grep -qiE "(add|fix|improve|enhance|update).*(feature|bug|performance|ui|ux|user|interface)"; then
   
   echo ""
   echo "📝 This looks like a user-facing change!"
   echo "Would you like to update the changelog? (y/n)"
   read -r response
   
   if [[ "$response" == "y" || "$response" == "Y" ]]; then
      npm run changelog
      
      # Check if changelog was modified
      if git status --porcelain | grep -q "CHANGELOG.md"; then
         echo ""
         echo "✅ Changelog updated! Don't forget to commit the changelog update:"
         echo "   git add CHANGELOG.md"
         echo "   git commit -m 'docs: Update changelog'"
      fi
   else
      echo "⚠️  Remember to update the changelog before release!"
   fi
fi
EOF

# Make the hook executable
chmod +x "$POST_COMMIT_HOOK"

echo "✅ Git hooks installed successfully!"
echo ""
echo "The post-commit hook will now prompt you to update the changelog"
echo "when it detects user-facing changes in your commits."
echo ""
echo "To disable this hook, run: rm $POST_COMMIT_HOOK"