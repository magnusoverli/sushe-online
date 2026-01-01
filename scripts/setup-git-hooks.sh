#!/bin/bash

# Setup git hooks for automatic changelog updates and code quality checks

HOOKS_DIR=".git/hooks"
PRE_COMMIT_HOOK="$HOOKS_DIR/pre-commit"
POST_COMMIT_HOOK="$HOOKS_DIR/post-commit"

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Create pre-commit hook for linting and formatting
cat > "$PRE_COMMIT_HOOK" << 'EOF'
#!/bin/bash

echo "🔍 Running pre-commit checks..."

# Get list of staged JS files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep '\.js$')

if [ -z "$STAGED_FILES" ]; then
  echo "✅ No JavaScript files to check"
  exit 0
fi

# Check if we're in a Docker environment
if [ -f "/.dockerenv" ] || [ -f "/run/.containerenv" ]; then
  # We're inside Docker, use npm directly
  NPM_CMD="npm"
else
  # We're on host, check if Docker Compose is available
  if command -v docker &> /dev/null && [ -f "docker-compose.local.yml" ]; then
    # Use Docker Compose
    NPM_CMD="docker compose -f docker-compose.local.yml exec -T app npm"
  elif command -v npm &> /dev/null; then
    # Use host npm
    NPM_CMD="npm"
  else
    echo "⚠️  Warning: npm not found and Docker not available. Skipping checks."
    exit 0
  fi
fi

# Run prettier check on staged files
echo "📝 Checking Prettier formatting..."
if ! echo "$STAGED_FILES" | xargs $NPM_CMD run format:check -- 2>&1; then
  echo ""
  echo "❌ Prettier formatting issues found!"
  echo "💡 Fix with: npm run format"
  echo "   Or auto-fix: git add -u && npm run format && git add -u"
  exit 1
fi

# Run ESLint with max-warnings 0 on staged files
echo "🔎 Checking ESLint rules..."
if ! echo "$STAGED_FILES" | xargs $NPM_CMD exec eslint -- --max-warnings 0 2>&1; then
  echo ""
  echo "❌ ESLint issues found!"
  echo "💡 Fix with: npm run lint:fix"
  exit 1
fi

echo "✅ All pre-commit checks passed!"
exit 0
EOF

chmod +x "$PRE_COMMIT_HOOK"

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
echo "Installed hooks:"
echo "  - pre-commit:  Runs prettier and eslint checks on staged files"
echo "  - post-commit: Prompts to update changelog for user-facing changes"
echo ""
echo "The pre-commit hook will catch formatting and linting issues"
echo "before they reach CI, saving you time and preventing failed builds."
echo ""
echo "To temporarily skip hooks, use: git commit --no-verify"
echo "To disable permanently: rm $PRE_COMMIT_HOOK $POST_COMMIT_HOOK"