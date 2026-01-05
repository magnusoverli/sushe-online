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

# Get list of staged files (JS, JSON, HTML, MJS)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs|json|html)$')

if [ -z "$STAGED_FILES" ]; then
  echo "✅ No JavaScript/JSON/HTML files to check"
  exit 0
fi

# Check if we're in a Docker environment
if [ -f "/.dockerenv" ] || [ -f "/run/.containerenv" ]; then
  # We're inside Docker, use npm directly
  NPM_CMD="npm"
  NODE_CMD="node"
else
  # We're on host, check if Docker Compose is available
  if command -v docker &> /dev/null && [ -f "docker-compose.local.yml" ]; then
    # Use Docker Compose
    NPM_CMD="docker compose -f docker-compose.local.yml exec -T app npm"
    NODE_CMD="docker compose -f docker-compose.local.yml exec -T app node"
  elif command -v npm &> /dev/null; then
    # Use host npm
    NPM_CMD="npm"
    NODE_CMD="node"
  else
    echo "⚠️  Warning: npm not found and Docker not available. Skipping checks."
    exit 0
  fi
fi

# Filter staged files to only source files (matching format:check:source pattern)
SOURCE_FILES=$(echo "$STAGED_FILES" | grep -E '^[^/]+\.(js|mjs|json)$|^(src|test|utils|middleware|routes|db|scripts|browser-extension)/.*\.(js|mjs|json|html)$' || true)

if [ -z "$SOURCE_FILES" ]; then
  echo "✅ No source files to check (only non-source files staged)"
  exit 0
fi

# Run prettier check on staged source files (prettier accepts multiple files)
echo "📝 Checking Prettier formatting on staged files..."
# Use npx or npm exec with -- to properly pass flags to prettier
if command -v npx &> /dev/null; then
  PRETTIER_CMD="npx prettier"
else
  PRETTIER_CMD="$NPM_CMD exec -- prettier"
fi

if ! echo "$SOURCE_FILES" | xargs -r $PRETTIER_CMD --check 2>&1; then
  echo ""
  echo "❌ Prettier formatting issues found in staged files!"
  echo "💡 Fix with: npm run format"
  echo "   Or auto-fix staged files: echo \"$SOURCE_FILES\" | xargs $PRETTIER_CMD --write && git add $SOURCE_FILES"
  exit 1
fi

# Run ESLint with max-warnings 0 on staged JS/MJS files only (matches lint:strict behavior)
JS_FILES=$(echo "$SOURCE_FILES" | grep -E '\.(js|mjs)$' || true)

if [ -n "$JS_FILES" ]; then
  echo "🔎 Checking ESLint rules on staged files (--max-warnings 0)..."
  # eslint accepts multiple files, use xargs for efficiency
  # Use -- to properly pass flags to eslint
  if ! echo "$JS_FILES" | xargs -r $NPM_CMD exec -- eslint --max-warnings 0 2>&1; then
    echo ""
    echo "❌ ESLint issues found in staged files!"
    echo "💡 Fix with: npm run lint:fix"
    echo "   Or fix specific files: echo \"$JS_FILES\" | xargs $NPM_CMD exec -- eslint --fix"
    exit 1
  fi
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