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
- **Test**: `npm test` (runs core tests - ~40 essential tests, 30 seconds)
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

### Test Suite Overview (~40 Essential Tests)

We focus on testing what matters: security, authentication, and critical paths.

**Philosophy**: We deploy with Docker. If it builds and security tests pass, ship it.

#### Core Tests (`npm test`)

- **Security Middleware** (17 tests): CSRF, XSS prevention, rate limiting, security headers
- **Session Management** (12 tests): Authentication flows, session persistence, security
- **Auth Utilities** (6 tests): Password hashing, token validation, auth helpers
- **Basic Smoke Tests** (5 tests): Server initialization, core routes, database connectivity

#### End-to-End Tests (`npm run test:e2e`)

- **Critical User Journeys**: Registration, login/logout, basic operations, security validation

### What We Don't Test

- **Mock-heavy integrations**: External APIs tested manually in staging
- **Admin operations**: Low-risk features verified manually
- **Utility functions**: Simple helpers don't need test overhead
- **Detailed route testing**: Docker + manual testing catches issues

### Running Tests

```bash
# Before committing (30 seconds)
npm test

# End-to-end browser tests
npm run test:e2e

# Individual test file
node --test test/security-middleware.test.js

# Coverage report (optional)
npm run test:coverage
```

### Test Quality Standards

- **Security first**: All security tests must pass before deployment
- **Manual testing**: Always verify UI/UX changes in browser
- **Trust Docker**: Container deployment ensures consistency
- **Quality over coverage**: 40 focused tests > 100 mocked tests

### Test File Structure

```
test/
├── security-middleware.test.js  # Security features (17 tests)
├── session-management.test.js   # Session handling (12 tests)
├── auth-utils.test.js          # Auth utilities (6 tests)
├── basic.test.js               # Smoke tests (5 tests)
└── e2e/
    └── basic.spec.js           # End-to-end workflows
```

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
