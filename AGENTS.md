# AGENTS.md - Development Guidelines

## 🚨 CRITICAL FOR AI AGENTS

**AUTOMATIC CHANGELOG UPDATES ARE MANDATORY**

After implementing ANY user-facing change (feature, fix, UI change, performance improvement), you MUST:

1. Complete the change
2. Test it
3. **AUTOMATICALLY run**: `npm run changelog "Description of change"`
4. Include "✅ Changelog updated" in your completion message

The user should NEVER have to remind you about the changelog!

## Commands

- **Build**: `npm run build` (builds CSS + JS)
- **Dev**: `npm run dev` (watch mode with nodemon)
- **Test**: `npm test` (runs all unit tests - 98+ comprehensive tests)
- **E2E Tests**: `npm run test:e2e` (runs end-to-end browser tests)
- **Test Coverage**: `npm run test:coverage` (runs tests with coverage report)
- **Test Watch**: `npm run test:watch` (runs tests in watch mode)
- **Single test**: `node --test test/filename.test.js`
- **Lint**: `npm run lint` (check code quality)
- **Format**: `npm run format` (format code with prettier)

### Smart Planning Commands

- **Create Plan**: `npm run smart:create "description"` (AI-powered plan creation)
- **Quick Plan**: `npm run smart:quick "task"` (fast task creation)
- **Dashboard**: `npm run smart:dashboard` (comprehensive metrics)
- **Status**: `npm run smart:status` (system status summary)
- **Analyze**: `npm run smart:analyze` (analysis with recommendations)
- **Watch**: `npm run smart:watch` (auto-tracking mode)
- **Update**: `npm run smart:update` (refresh all systems)

## Code Style & Best Practices

- **Imports**: Prefer ES6 modules (`import`/`export`) when possible, use CommonJS for Node.js compatibility
- **Formatting**: Use Prettier with 2-space indentation, consistent semicolons, trailing commas
- **Variables**: Use `const` by default, `let` when reassignment needed, avoid `var`
- **Functions**: Prefer arrow functions, descriptive names, async/await over callbacks/promises
- **Error handling**: Always use try/catch for async operations, implement proper error boundaries
- **Types**: Consider adding TypeScript for better type safety and developer experience
- **Testing**: Write comprehensive tests, aim for >80% coverage, use descriptive test names
- **Regression testing**: Always test existing functionality after changes, run full test suite before commits

## Security & Performance

- **Dependencies**: Keep packages updated, audit regularly with `npm audit`
- **Environment**: Use `.env` files, never commit secrets, validate all inputs
- **Database**: Use connection pooling, parameterized queries, implement proper indexing
- **Authentication**: Use secure session management, implement rate limiting
- **Headers**: Configure security headers (CSP, HSTS), enable CORS properly
- **Validation**: Sanitize inputs, validate on both client and server side

## Architecture Principles

- **Separation of concerns**: Keep routes thin, business logic in services
- **Error handling**: Centralized error middleware, consistent error responses
- **Logging**: Structured logging with appropriate levels (info, warn, error)
- **Configuration**: Environment-based config, feature flags for gradual rollouts
- **Documentation**: Keep README updated, document API endpoints, add inline docs for complex logic

## Quality Assurance

### Test Suite Overview (110+ Tests)

The comprehensive test suite covers all critical application areas:

#### Unit Tests (`npm test`)

- **Route Handler Tests** (45+ tests):
  - `test/routes-auth.test.js` - Authentication, registration, login, settings
  - `test/routes-api.test.js` - API endpoints, list management, external integrations
  - `test/routes-admin.test.js` - Admin operations, user management, database ops
- **Security Middleware Tests** (17 tests):
  - `test/security-middleware.test.js` - CSRF, XSS prevention, rate limiting, headers
- **Session Management Tests** (12 tests):
  - `test/session-management.test.js` - Authentication flows, session persistence, security
- **Core Utility Tests** (19 tests):
  - `test/auth-utils.test.js`, `test/utils.test.js`, `test/middleware.test.js`, etc.

#### End-to-End Tests (`npm run test:e2e`)

- **User Workflows** (25+ scenarios):
  - `test/e2e/basic.spec.js` - Complete user journeys, authentication flows, responsive design
  - Registration, login, password reset, settings management
  - Security validation, performance checks, accessibility testing

### Test Categories

1. **Authentication & Authorization**
   - User registration with validation
   - Login/logout flows
   - Session management and security
   - Admin privilege testing

2. **Security Testing**
   - CSRF protection validation
   - XSS prevention and input sanitization
   - Security headers (CSP, XSS, clickjacking)
   - Rate limiting and abuse prevention

3. **API & Route Testing**
   - All REST endpoints
   - Request/response validation
   - Error handling and edge cases
   - Database operations

4. **Integration Testing**
   - External API integrations (Deezer proxy, basic Spotify/Tidal auth checks)
   - Database connectivity and operations
   - Email functionality (password reset flows)
   - URL metadata fetching

5. **Performance & Reliability**
   - Response time validation
   - Memory leak detection
   - Concurrent user handling
   - Error recovery testing

### Running Tests

- **Full Test Suite**: `npm test` (runs all unit tests, ~2-3 minutes)
- **Quick Security Check**: `node --test test/security-middleware.test.js`
- **Auth Flow Testing**: `node --test test/routes-auth.test.js`
- **E2E User Journeys**: `npm run test:e2e`
- **Coverage Report**: `npm run test:coverage` (generates HTML report)

### Test Quality Standards

- **Regression prevention**: Test core user flows (login, registration, data operations) after any changes
- **Security validation**: All security middleware and authentication flows are tested
- **Manual testing**: Verify UI/UX changes in browser, test edge cases and error scenarios
- **Database integrity**: Ensure migrations don't break existing data, backup before schema changes
- **Performance monitoring**: Check for memory leaks, slow queries, and response time degradation

### Expected Test Results

When running `npm test`, you should see:

- **110+ total tests**
- **100+ passing tests** (clean test suite with non-working tests removed)
- **All security tests passing** (critical for production)
- **All session management tests passing** (critical for user experience)
- **Core utility tests passing** (foundation functionality)
- **All authentication and authorization tests passing** (user management)

### Test Maintenance

- Add tests for new features before implementation
- Update tests when changing existing functionality
- Run full test suite before commits
- Monitor test coverage and aim for >80%
- Review and update e2e tests quarterly

## Test Automation & CI/CD Ready

### Quick Test Commands for AI Agents

When asked to "run tests" or "test the application", use these commands:

```bash
# Full test suite (recommended)
npm test

# With coverage report
npm run test:coverage

# End-to-end tests (requires running server)
npm run test:e2e

# Security-focused testing
node --test test/security-middleware.test.js
node --test test/session-management.test.js

# Route testing
node --test test/routes-auth.test.js
node --test test/routes-api.test.js
node --test test/routes-admin.test.js
```

### Test File Structure

```
test/
├── routes-auth.test.js      # Authentication & user management (16 tests)
├── routes-api.test.js       # API endpoints & integrations (20 tests)
├── routes-admin.test.js     # Admin operations & OAuth (15 tests)
├── security-middleware.test.js # Security features (17 tests)
├── session-management.test.js  # Session handling (12 tests)
├── auth-utils.test.js       # Authentication utilities (6 tests)
├── middleware.test.js       # Error handling middleware (5 tests)
├── utils.test.js           # Core utilities (6 tests)
├── logger.test.js          # Logging functionality (3 tests)
├── playlist.test.js        # Playlist operations (2 tests)
├── basic.test.js           # Basic functionality (1 test)
└── e2e/
    └── basic.spec.js       # End-to-end user workflows (25+ scenarios)
```

### CI/CD Integration

The test suite is designed for automated testing:

- **Fast execution**: Unit tests complete in 2-3 minutes
- **Isolated tests**: No external dependencies required for unit tests
- **Comprehensive coverage**: Tests all critical paths and security features
- **Clear reporting**: Detailed output for debugging failures
- **Parallel execution**: Tests can run concurrently for faster CI/CD

## Git Commit Guidelines

- **Commit messages**: Write meaningful commits that clearly describe the change with personality and wit
- **Structure**: Lead with a catchy summary, then use bullet points for detailed changes
- **Tone**: Professional but playful - make code reviews more enjoyable to read
- **Examples**:
  - "Tame the linting beast: from 500+ errors to just 13 survivors"
  - "Banish the authentication gremlins that were eating user sessions"
  - "Add database migrations (because schema changes shouldn't be a surprise party)"
  - "Fix memory leak that was hungrier than a teenager after school"
  - "Refactor API endpoints to be less chatty than a parrot on caffeine"

## Changelog Management

### Automatic Changelog Updates

**IMPORTANT**: Always update the CHANGELOG.md when implementing user-facing features or fixes.

⚠️ **FOR AI AGENTS (Claude, ChatGPT, Cursor, etc.)**: You MUST automatically update the changelog after ANY user-facing change. The user should NOT have to remind you. This is a mandatory step in your workflow.

### Quick Commands

```bash
# Interactive mode (recommended for AI agents)
npm run changelog

# Quick update with description
npm run changelog "Added dark mode toggle to settings"

# Quick update with category
npm run changelog fix "Resolved session timeout issues"

# Parse from git commit message
npm run changelog:git "feat: Added export to CSV functionality"
```

### Categories for Changes

- **feature** - New user-facing features (default)
- **fix** - Bug fixes that users will notice
- **perf** - Performance improvements users will feel
- **security** - Security updates users should know about
- **ui** - UI/UX improvements and changes
- **docs** - User-facing documentation updates

### When to Update Changelog

**ALWAYS update for:**

- New features users can interact with
- Bug fixes users reported or will notice
- Performance improvements users will feel
- Security patches affecting user data
- UI/UX changes users will see
- Breaking changes or removed features

**SKIP updates for:**

- Internal refactoring with no user impact
- Development tooling changes
- Test additions/improvements (unless fixing user-reported issues)
- Code style/formatting changes
- Documentation fixes (unless user-facing docs)

### AI Agent Instructions

**MANDATORY**: When implementing changes as an AI agent, you MUST:

1. **Immediately after completing ANY user-facing change**, run:

   ```bash
   npm run changelog "Description of the change"
   ```

2. **DO NOT wait for user to remind you** - this should be automatic in your workflow

3. **Include in your completion message** something like:
   ```
   ✅ Feature implemented and tested
   ✅ Changelog updated automatically
   ```

**User-facing changes include:**

- Any new feature visible to users
- Any bug fix users would notice
- Any performance improvement users would feel
- Any UI/UX change
- Any security fix affecting user data

**This is NOT optional - treat it as part of the task completion**

### Examples for AI Agents

```bash
# After adding a new feature
npm run changelog "Added bulk track selection in playlists"

# After fixing a bug
npm run changelog fix "Fixed playlist duplication error"

# After performance improvement
npm run changelog perf "Optimized album artwork loading speed"

# After UI changes
npm run changelog ui "Improved mobile responsiveness for playlist view"

# After security fix
npm run changelog security "Enhanced session token validation"
```

### Commit + Changelog Workflow

1. Make your changes
2. Test the changes
3. Update changelog: `npm run changelog`
4. Stage all files: `git add .`
5. Commit with descriptive message
6. The changelog is now ready for the next release

### Changelog Format

The changelog follows this structure:

- Date-based sections (YYYY-MM-DD format)
- Bold descriptions for clarity
- Optional details after dash
- User-focused language (avoid technical jargon)

### Best Practices

- Write from the user's perspective
- Use present tense ("Adds" not "Added" in the entry)
- Be specific but concise
- Group related changes together
- Include impact or benefit when relevant

### Automatic Changelog Updates

**IMPORTANT**: Always update the CHANGELOG.md when implementing user-facing features or fixes.

#### For Developers - Git Hook Setup

Install the git hook that prompts for changelog updates after commits:

```bash
npm run changelog:setup
```

This will:

- Install a post-commit hook
- Automatically detect user-facing changes in commit messages
- Prompt you to update the changelog after relevant commits
- Remind you which changes need documentation

To remove the hook: `rm .git/hooks/post-commit`

#### For AI Agents - Automatic Updates

**THIS IS MANDATORY - NOT OPTIONAL**

When working as an AI agent, your workflow MUST be:

1. **Complete the feature/fix**
2. **Run tests to verify**
3. **AUTOMATICALLY update the changelog** (without being asked):
   ```bash
   npm run changelog "Description of the change"
   ```
4. **Report completion WITH changelog confirmation**:
   ```
   "✅ Fixed the login validation issue
    ✅ All tests passing
    ✅ Changelog updated automatically"
   ```

**Use the appropriate category**:

- `npm run changelog "Added bulk track selection"` (defaults to feature)
- `npm run changelog fix "Fixed playlist duplication error"`
- `npm run changelog perf "Optimized album artwork loading"`
- `npm run changelog security "Enhanced session validation"`
- `npm run changelog ui "Improved mobile responsiveness"`

**REMEMBER**: Users should NEVER have to ask "did you update the changelog?" - it should already be done!

### Verification

After updating the changelog:

1. Check that the entry appears under today's date
2. Verify the description is user-friendly (no technical jargon)
3. Ensure similar changes are grouped together
