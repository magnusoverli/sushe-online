# AGENTS.md - Development Guidelines

## 🚨 CRITICAL FOR AI AGENTS

### DO NOT CREATE DOCUMENTATION FILES

**You MUST NOT create any markdown (.md) files unless explicitly requested by the user.**

This includes:

- Analysis documents (performance, architecture, etc.)
- Planning documents
- API documentation
- Technical notes or guides
- Best practices documents
- Any other .md files

**What to do instead:**

- Communicate findings directly in the conversation
- Add code comments for complex logic (when needed)
- Update existing documentation only if explicitly told

**Only exception:** User directly asks you to create a specific documentation file.

## Commands

- **Build**: `npm run build` (builds CSS + JS)
- **Dev**: `npm run dev` (watch mode with nodemon)
- **Test**: `npm test` (runs strict linting + core tests - ~1138 tests, ~37 seconds)
- **E2E Tests**: `PLAYWRIGHT_SKIP_SERVER=1 npx playwright test` (runs end-to-end browser tests headless on host)
- **Test Coverage**: `npm run test:coverage` (runs tests with coverage report)
- **Test Watch**: `npm run test:watch` (runs tests in watch mode)
- **Single test**: `node --test test/filename.test.js`
- **Lint**: `npm run lint` (check code quality, allows warnings)
- **Lint Strict**: `npm run lint:strict` (check code + formatting, treats warnings as errors)
- **Format**: `npm run format` (format code with prettier)
- **Format Check**: `npm run format:check` (verify formatting without changes)

### Container vs Local Execution

**Run INSIDE container** (use `docker compose -f docker-compose.local.yml exec app <command>`):
- `npm test` - Full test suite with strict linting (~1138 tests, ~37 seconds)
- `npm run test:coverage` - Test coverage
- `npm run test:watch` - Watch mode tests
- `npm run lint:strict` - Strict linting (prettier + eslint with no warnings)
- `node --test test/filename.test.js` - Individual tests

**Run OUTSIDE container** (use directly on host):
- `npm run lint` - ESLint code quality checks (if npm available)
- `npm run format` - Prettier formatting (if npm available)
- `PLAYWRIGHT_SKIP_SERVER=1 npx playwright test` - End-to-end browser tests (headless, requires Docker containers running)

**Prerequisites for E2E tests on host:**
```bash
# First time only: Install Playwright browsers on your host machine
npx playwright install --with-deps chromium
```

**Why this separation?**
- Core tests need the database and full application environment (container provides this)
- Linting/formatting CAN run on host if npm available, but container is more reliable
- E2E tests run on host but connect to the containerized app at http://localhost:3000 (avoids slow Playwright browser installation in Docker, saving ~5 minutes per build)

### Handling Test Failures

**IMPORTANT: Always verify linting passes before committing, even if tests fail.**

When `npm test` fails due to infrastructure issues (e.g., coverage directory permissions, Docker issues), **always run linting separately** to catch issues that would fail CI:

```bash
# If npm test fails due to infrastructure issues, run these separately:
docker compose -f docker-compose.local.yml exec app npm run lint:strict
docker compose -f docker-compose.local.yml exec app npm run format:check
```

**Why this matters:**
- `npm test` runs `lint:strict` which treats warnings as errors (`--max-warnings 0`)
- CI will fail on formatting issues (prettier) and linting warnings (eslint)
- Infrastructure failures (permissions, Docker) can mask linting issues
- Always verify linting passes independently before committing

**Common scenarios:**
- Coverage directory permission errors → Run `lint:strict` separately
- Docker container issues → Run `lint:strict` separately
- Test timeouts → Run `lint:strict` separately
- Any `npm test` failure → Verify linting before committing

**Best practice workflow:**
1. Make code changes
2. Run `npm test` (or individual test files)
3. **If tests fail due to infrastructure**: Run `npm run lint:strict` separately
4. Fix any linting/formatting issues
5. Commit only when linting passes

### Pre-commit Hooks (Recommended)

**Install git hooks to catch issues before commit:**
```bash
npm run changelog:setup
# or manually:
bash scripts/setup-git-hooks.sh
```

This installs:
- **pre-commit**: Runs prettier + eslint checks on staged files (catches formatting issues before CI)
- **post-commit**: Prompts to update changelog for user-facing changes

**Benefits:**
- Catches prettier/eslint errors immediately
- Prevents CI failures from formatting issues
- Faster feedback loop (seconds vs minutes waiting for CI)

**Skip hooks if needed:**
```bash
git commit --no-verify  # Skip for emergency commits only
```

## Code Style & Best Practices

- **Imports**: Prefer ES6 modules (`import`/`export`) when possible, use CommonJS for Node.js compatibility
- **Formatting**: Use Prettier with 2-space indentation, consistent semicolons, trailing commas
- **Variables**: Use `const` by default, `let` when reassignment needed, avoid `var`
- **Functions**: Prefer arrow functions, descriptive names, async/await over callbacks/promises
- **Error handling**: Always use try/catch for async operations, implement proper error boundaries
- **Types**: Consider adding TypeScript for better type safety and developer experience
- **Testing**: Test what matters - security, auth, critical paths. Quality over quantity.
- **Regression testing**: Run `npm test` before commits - if security tests pass, you're good

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
- **Code comments**: Add inline comments only for complex/non-obvious logic

## Logging Guidelines

This codebase uses **Pino** for structured JSON logging. All backend code should use the logger from `utils/logger.js`.

### Usage

```javascript
const logger = require('./utils/logger');

// Basic logging
logger.info('User logged in', { userId: user._id, email: user.email });
logger.warn('Rate limit approaching', { ip: req.ip, remaining: 5 });
logger.error('Database query failed', { error: err.message, stack: err.stack });
logger.debug('Cache hit', { key: cacheKey });
```

### Log Levels Strategy

| Level | When to Use | Examples |
|-------|-------------|----------|
| **ERROR** | Unexpected failures requiring attention | Database connection failures, unhandled exceptions, critical API errors |
| **WARN** | Expected errors or concerning events | Failed login attempts, rate limit hits, deprecated feature usage |
| **INFO** | Normal application flow (production default) | Server startup, user registration, major operations, admin actions |
| **DEBUG** | Detailed diagnostic info (development only) | SQL queries, cache details, step-by-step flow |

### Structured Logging Patterns

Always use objects for metadata instead of string interpolation:

```javascript
// ❌ BAD: String interpolation
logger.info('User logged in:', email);
logger.error('Database error:', err);

// ✅ GOOD: Structured objects
logger.info('User logged in', { email, userId: user._id, requestId: req.id });
logger.error('Database query failed', { error: err.message, stack: err.stack, operation: 'findOne' });
```

### Standard Patterns by Event Type

#### Authentication Events

```javascript
// Login attempt
logger.info('Login attempt', { email, ip: req.ip, requestId: req.id });

// Success
logger.info('User logged in', { userId: user._id, email, requestId: req.id });

// Failure (use warn, not error)
logger.warn('Login failed', { email, reason: 'invalid_credentials', requestId: req.id });
```

#### Database Operations

```javascript
// Slow queries (>100ms)
logger.warn('Slow database query', { operation: 'findWithAlbumData', duration_ms: elapsed, listId });

// Database errors
logger.error('Database operation failed', { operation: 'insert', table: 'users', error: err.message });
```

#### External API Calls

```javascript
// API requests
logger.debug('External API request', { service: 'spotify', endpoint: '/v1/me' });

// API responses
logger.info('External API response', { service: 'spotify', status: 200, duration_ms: elapsed });

// API errors (warn for 4xx, error for 5xx)
logger.warn('External API rate limited', { service: 'spotify', status: 429, retryAfter: headers['retry-after'] });
```

#### Admin Actions (Audit Trail)

```javascript
logger.info('Admin action', { action: 'approve_user', adminId: req.user._id, targetUserId: userId, ip: req.ip });
```

#### Security Events

```javascript
// Rate limiting
logger.warn('Rate limit exceeded', { ip: req.ip, endpoint: req.path, userId: req.user?._id });

// CSRF failures
logger.warn('CSRF token validation failed', { requestId: req.id, ip: req.ip, endpoint: req.path });
```

### Child Loggers for Request Context

Use child loggers to bind context throughout request lifecycle:

```javascript
app.post('/api/lists/:id', ensureAuthAPI, async (req, res) => {
  const requestLogger = logger.child({
    requestId: req.id,
    userId: req.user._id,
    listId: req.params.id
  });

  requestLogger.info('List update started');
  requestLogger.debug('Validating input');
  requestLogger.info('List updated successfully');
});
```

### What NOT to Log

Never log sensitive data:

- ❌ Passwords (plain or hashed)
- ❌ Session tokens
- ❌ API keys or secrets
- ❌ CSRF tokens
- ❌ Full credit card numbers
- ✅ User IDs (non-sensitive identifiers)
- ✅ Email addresses (for audit trails)
- ✅ IP addresses (for security monitoring)

### Environment Configuration

- `LOG_LEVEL`: Set to ERROR, WARN, INFO, or DEBUG (default: INFO)
- `NODE_ENV=production`: Outputs JSON format for log aggregation
- `NODE_ENV=development`: Pretty-prints with colors for readability
- `LOG_SQL=true`: Enables SQL query logging at DEBUG level

### Frontend/Browser Code

Frontend code (`src/js/*`, `browser-extension/*`) should continue using `console.*` for browser DevTools debugging.

## Quality Assurance

### Test Suite Overview

We focus on testing what matters: security, authentication, and critical paths.

#### Core Tests (`npm test`)

- **Security Middleware**: CSRF, XSS prevention, rate limiting, security headers
- **Session Management**: Authentication flows, session persistence, security
- **Auth Utilities**: Password hashing, token validation, auth helpers
- **Basic Smoke Tests**: Server initialization, core routes, database connectivity

#### End-to-End Tests (Headless Browser Tests)

- **Critical User Journeys**: Registration, login/logout, basic operations, security validation
- **Run on host**: Connects to containerized app at http://localhost:3000
- **Headless execution**: Tests run without UI for speed and CI compatibility

### Running Tests

```bash
# Core tests (run inside container)
docker compose -f docker-compose.local.yml exec app npm test

# End-to-end browser tests (run on host, headless)
PLAYWRIGHT_SKIP_SERVER=1 npx playwright test

# Individual test file (run inside container)
docker compose -f docker-compose.local.yml exec app node --test test/filename.test.js

# Coverage report (run inside container)
docker compose -f docker-compose.local.yml exec app npm run test:coverage
```

### Test Quality Standards

- **Security first**: All security tests must pass before deployment
- **Aim for good coverage**: Increase test coverage where practical
- **Manual testing**: Always verify UI/UX changes in browser

### Writing Tests for New Code

**When introducing new code, ALWAYS write corresponding tests.**

#### What Requires Tests

- **New utilities/helpers**: Any new function in `utils/`, `validators.js`, `auth-utils.js`, etc.
- **New middleware**: Request handlers, error handlers, security features
- **New API endpoints**: Routes that handle user data or business logic
- **Bug fixes**: Add a test that would have caught the bug before fixing it
- **Security features**: Authentication, authorization, input validation, sanitization

#### What May Skip Tests

- **Trivial changes**: Typo fixes, comment updates, formatting
- **View templates**: EJS files (test the data they receive, not the HTML)
- **Build scripts**: One-off utility scripts in `scripts/`
- **Configuration**: Package.json, docker-compose, etc.

#### Test-Writing Workflow

1. **Design for testability**: Use dependency injection pattern (see below)
2. **Write the test first** (or immediately after): Don't wait until "later"
3. **Follow existing patterns**: Look at similar tests in `test/` for structure
4. **Test the behavior**: Focus on inputs/outputs and edge cases, not implementation
5. **Run tests locally**: `npm test` before committing
6. **Verify coverage**: Use `npm run test:coverage` to ensure critical paths are covered

#### Example: Adding a New Utility

```javascript
// ✅ GOOD: Write the utility with dependency injection
// utils/email-sender.js
function createEmailSender(deps = {}) {
  const logger = deps.logger || require('./logger');
  const fetch = deps.fetch || require('node-fetch');

  async function sendEmail(to, subject, body) {
    logger.info(`Sending email to ${to}`);
    // ... implementation
    return { success: true };
  }

  return { sendEmail };
}

const defaultInstance = createEmailSender();
module.exports = { createEmailSender, ...defaultInstance };
```

```javascript
// ✅ GOOD: Write the test immediately
// test/email-sender.test.js
const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createEmailSender } = require('../utils/email-sender.js');

describe('email-sender', () => {
  it('should send email with correct parameters', async () => {
    const mockLogger = { info: mock.fn(), error: mock.fn() };
    const mockFetch = mock.fn(() => Promise.resolve({ ok: true }));

    const { sendEmail } = createEmailSender({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const result = await sendEmail('test@example.com', 'Hello', 'World');

    assert.strictEqual(result.success, true);
    assert.strictEqual(mockLogger.info.mock.calls.length, 1);
  });
});
```

#### Why This Matters

- **Prevents regressions**: Tests catch breaking changes before deployment
- **Documents behavior**: Tests show how code is meant to be used
- **Enables refactoring**: Confident changes when tests pass
- **Maintains quality**: Keeps codebase reliable and maintainable

### Test File Structure

```
test/
├── auth-utils.test.js          # Auth utilities (26 tests)
├── basic.test.js               # Smoke tests (5 tests)
├── color-utils.test.js         # Color utilities (16 tests)
├── error-handler.test.js       # Error handling (32 tests)
├── logger.test.js              # Logging (24 tests)
├── retry-wrapper.test.js       # DB health check (11 tests)
├── security-middleware.test.js # Security features (17 tests)
├── session-management.test.js  # Session handling (12 tests)
├── spotify-auth.test.js        # Spotify auth (24 tests)
├── templates.test.js           # Template utilities (30 tests)
├── validators.test.js          # Input validation (20 tests)
└── e2e/
    └── basic.spec.js           # End-to-end workflows
```

### Writing Testable Code (Dependency Injection Pattern)

Modules should use **dependency injection** to allow tests to mock external dependencies without creating duplicate files.

#### Pattern for Modules

```javascript
// utils/example.js
function createExample(deps = {}) {
  // Inject dependencies with defaults for production use
  const logger = deps.logger || require('./logger');
  const db = deps.db || require('../db');

  function doSomething() {
    logger.info('Doing something');
    return db.query('SELECT * FROM things');
  }

  return { doSomething };
}

// Create default instance for app to use unchanged
const defaultInstance = createExample();

// Export both factory (for tests) and default functions (for app)
module.exports = { createExample, ...defaultInstance };
```

#### Pattern for Tests

```javascript
// test/example.test.js
const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createExample } = require('../utils/example.js');

describe('example', () => {
  it('should log and query database', async () => {
    // Create mocks
    const mockLogger = { info: mock.fn(), error: mock.fn() };
    const mockDb = { query: mock.fn(() => Promise.resolve([{ id: 1 }])) };

    // Inject mocks via factory
    const { doSomething } = createExample({
      logger: mockLogger,
      db: mockDb,
    });

    const result = await doSomething();

    assert.strictEqual(mockLogger.info.mock.calls.length, 1);
    assert.strictEqual(mockDb.query.mock.calls.length, 1);
    assert.deepStrictEqual(result, [{ id: 1 }]);
  });
});
```

#### Existing Modules Using This Pattern

| Module                         | Factory Function             | Injectable Dependencies |
| ------------------------------ | ---------------------------- | ----------------------- |
| `utils/spotify-auth.js`        | `createSpotifyAuth(deps)`    | `fetch`                 |
| `utils/logger.js`              | `Logger` class               | `console`, `fs`         |
| `middleware/response-cache.js` | `ResponseCache` class        | None (self-contained)   |
| `middleware/error-handler.js`  | `createErrorHandler(logger)` | `logger`                |

#### Benefits

- **No duplicate files**: Tests import from the same file as production code
- **Full control**: Tests can inject mocks for any dependency
- **Zero app changes**: Default exports work exactly as before
- **Isolated tests**: Each test gets fresh mocks, no shared state

### CI/CD Integration

- **Fast execution**: Core tests run in ~30 seconds
- **Essential coverage**: Tests security, auth, and critical functionality
- **Clear reporting**: Quick feedback on what matters
- **Docker-ready**: Tests designed for containerized deployment

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
