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
- **Test**: `npm test` (runs core tests - ~215 tests, ~30 seconds)
- **E2E Tests**: `npm run test:e2e` (runs end-to-end browser tests)
- **Test Coverage**: `npm run test:coverage` (runs tests with coverage report)
- **Test Watch**: `npm run test:watch` (runs tests in watch mode)
- **Single test**: `node --test test/filename.test.js`
- **Lint**: `npm run lint` (check code quality)
- **Format**: `npm run format` (format code with prettier)

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

## Quality Assurance

### Test Suite Overview

We focus on testing what matters: security, authentication, and critical paths.

#### Core Tests (`npm test`)

- **Security Middleware**: CSRF, XSS prevention, rate limiting, security headers
- **Session Management**: Authentication flows, session persistence, security
- **Auth Utilities**: Password hashing, token validation, auth helpers
- **Basic Smoke Tests**: Server initialization, core routes, database connectivity

#### End-to-End Tests (`npm run test:e2e`)

- **Critical User Journeys**: Registration, login/logout, basic operations, security validation

### Running Tests

```bash
# Before committing
npm test

# End-to-end browser tests
npm run test:e2e

# Individual test file
node --test test/filename.test.js

# Coverage report
npm run test:coverage
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
