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
- **Test**: `npm test` (runs `lint:strict` internally, then core tests, then playwright if not in CI - ~1138 tests, ~37 seconds)
- **E2E Tests**: `PLAYWRIGHT_SKIP_SERVER=1 npx playwright test` (runs end-to-end browser tests headless on host)
- **Test Coverage**: `npm run test:coverage` (runs tests with coverage report)
- **Test Watch**: `npm run test:watch` (runs tests in watch mode)
- **Single test**: `node --test test/filename.test.js`
- **Lint**: `npm run lint` (check code quality with eslint, allows warnings) - **Note: CI runs this first, but both this and `lint:strict` can fail CI**
- **Lint Strict**: `npm run lint:strict` (runs `format:check:source` + `eslint . --max-warnings 0`, treats warnings as errors) - **This is what CI's `npm test` runs internally and is the stricter check that will fail CI if issues are found**
- **Format**: `npm run format` (format code with prettier - formats all files)
- **Format Check**: `npm run format:check` (verify formatting without changes - checks all files)
- **Format Check Source**: `npm run format:check:source` (checks only source code directories: `*.{js,mjs,json}` and `{src,test,utils,middleware,routes,db,scripts,browser-extension}/**/*.{js,mjs,json,html}` - used by `lint:strict`)

### Container vs Local Execution

**IMPORTANT: The container mounts the local directory as a volume.** When you run commands inside the container, they operate on your local files directly. There is no distinction between "container files" and "local files" - they are the same files.

**Run INSIDE container** (use `docker compose -f docker-compose.local.yml exec app <command>`):

- `npm test` - Full test suite (~1138 tests, ~37 seconds) - **Note: This runs lint:strict internally, but linting should be verified locally before committing**
- `npm run test:coverage` - Test coverage
- `npm run test:watch` - Watch mode tests
- `npm run format` - Format code with prettier (formats your local files)
- `node --test test/filename.test.js` - Individual tests

**Run OUTSIDE container** (use directly on host):

- `npm run lint` - Check code quality (allows warnings)
- `npm run lint:strict` - **CRITICAL: Always run this locally before committing** - Strict linting (prettier + eslint with no warnings)
- `npm run format:check` - Verify formatting without changes
- `PLAYWRIGHT_SKIP_SERVER=1 npx playwright test` - End-to-end browser tests (headless, requires Docker containers running)

**⚠️ CRITICAL: Lint/eslint commands MUST be run locally, NOT in the container!**

- CI runs linting in the local environment, not in Docker
- Container's prettier/eslint versions may differ from CI, causing false positives/negatives
- Always verify formatting with `npm run lint:strict` locally before committing
- The container's prettier may format code differently than CI's prettier, leading to CI failures

**Prerequisites for E2E tests on host:**

```bash
# First time only: Install Playwright browsers on your host machine
npx playwright install --with-deps chromium
```

**Why use the container?**

- Core tests need the database and full application environment (container provides this)
- Consistent Node.js version and dependencies across all environments
- npm may not be available on the host machine
- E2E tests are the exception: they run on host but connect to the containerized app at http://localhost:3000 (avoids slow Playwright browser installation in Docker, saving ~5 minutes per build)

**Why lint locally instead of in container?**

- **CI runs linting in local environment**, not in Docker container
- Container's prettier/eslint versions may differ from CI's versions
- Container's formatting rules may not match CI's expectations
- Running lint locally ensures you catch the same issues CI will catch
- Prevents false positives/negatives that lead to CI failures after commit

### Formatting Before Commit

**CRITICAL: Always run prettier before committing changes.**

```bash
# Format all modified files (run inside container)
docker compose -f docker-compose.local.yml exec app npm run format
```

Since the container mounts your local directory, this command formats your local files directly. Always run this before committing to avoid CI failures from prettier violations.

**Recommended workflow:**

1. Make code changes
2. Run `docker compose -f docker-compose.local.yml exec app npm run format` (format in container)
3. **Run `npm run lint:strict` locally** (verify linting matches CI expectations)
4. Commit your changes

**Why format in container but lint locally?**

- Formatting: Container's prettier formats files, which is fine for initial formatting
- Linting: **Must run locally** because CI uses local environment - container's eslint/prettier versions may differ and give false results

### Handling Test Failures

**IMPORTANT: Always verify linting passes before committing, even if tests fail.**

When `npm test` fails due to infrastructure issues (e.g., coverage directory permissions, Docker issues), **always run linting separately** to catch issues that would fail CI:

```bash
# If npm test fails due to infrastructure issues, run these separately LOCALLY:
npm run lint:strict  # Run locally, NOT in container!
npm run format:check  # Run locally to verify formatting matches CI
```

**⚠️ IMPORTANT: These commands must run locally, not in the container!**

**Why this matters:**

- `npm test` runs `lint:strict` internally, which runs `format:check:source` + `eslint . --max-warnings 0`
- CI runs `npm run lint` first (allows warnings), then `npm test` (which includes `lint:strict` - no warnings)
- **Both `npm run lint` and `npm test` (via `lint:strict`) can fail CI** - `lint:strict` is the stricter check that treats warnings as errors and checks formatting
- Infrastructure failures (permissions, Docker) can mask linting issues
- Always verify `lint:strict` passes locally before committing (matches what CI's `npm test` will check)

**Common scenarios:**

- Coverage directory permission errors → Run `lint:strict` separately
- Docker container issues → Run `lint:strict` separately
- Test timeouts → Run `lint:strict` separately
- Any `npm test` failure → Verify linting before committing

**Best practice workflow:**

1. Make code changes
2. Run `docker compose -f docker-compose.local.yml exec app npm run format` (format in container)
3. Run `npm run lint:strict` **locally** (verify linting matches CI)
4. Run `docker compose -f docker-compose.local.yml exec app npm test` (or individual test files)
5. **If tests fail due to infrastructure**: Run `npm run lint:strict` **locally** again to verify
6. Fix any linting/formatting issues
7. Commit only when linting passes locally

### Pre-commit Hooks (Recommended)

**Install git hooks to catch issues before commit:**

```bash
npm run changelog:setup
# or manually:
bash scripts/setup-git-hooks.sh
```

This installs:

- **pre-commit**: Runs `format:check` + `eslint --max-warnings 0` on staged JavaScript files only (catches formatting and linting issues before CI)
- **post-commit**: Prompts to update changelog for user-facing changes

**Benefits:**

- Catches prettier/eslint errors immediately
- Prevents CI failures from formatting issues
- Faster feedback loop (seconds vs minutes waiting for CI)

**Skip hooks if needed:**

```bash
git commit --no-verify  # Skip for emergency commits only
```

## Design Principles: DRY, SoC, and SOLID

**CRITICAL: All code changes MUST adhere to these principles.** When writing or modifying code, actively check against each principle below.

### DRY (Don't Repeat Yourself)

**Rule**: Every piece of knowledge should have a single, authoritative representation in the codebase.

#### When to Apply DRY

- **Repeated logic** (3+ lines appearing 2+ times) → Extract to a function
- **Repeated values** (magic numbers/strings) → Extract to constants
- **Similar patterns** (slight variations) → Extract to parameterized function
- **Duplicated validation** → Create reusable validators
- **Copy-pasted code blocks** → Refactor immediately

#### DRY Examples

```javascript
// ❌ BAD: Repeated validation logic
app.post('/api/users', (req, res) => {
  if (!req.body.email || !req.body.email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  // ... user creation
});

app.post('/api/profile', (req, res) => {
  if (!req.body.email || !req.body.email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  // ... profile update
});

// ✅ GOOD: Extract validation to reusable validator
// validators.js
function validateEmail(email) {
  if (!email || !email.includes('@')) {
    throw new ValidationError('Invalid email');
  }
}

// routes
app.post('/api/users', (req, res) => {
  validateEmail(req.body.email);
  // ... user creation
});

app.post('/api/profile', (req, res) => {
  validateEmail(req.body.email);
  // ... profile update
});
```

```javascript
// ❌ BAD: Magic numbers and strings
if (user.attempts >= 5) {
  lockAccount(user, 900000); // What is 900000?
}

// ✅ GOOD: Named constants
const MAX_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

if (user.attempts >= MAX_LOGIN_ATTEMPTS) {
  lockAccount(user, ACCOUNT_LOCK_DURATION_MS);
}
```

#### DRY Checklist Before Committing

- [ ] No code blocks repeated more than once
- [ ] All magic numbers/strings replaced with named constants
- [ ] Similar functions consolidated with parameters
- [ ] Validation logic reused via `validators.js`
- [ ] Database queries extracted to repository/model layer

### SoC (Separation of Concerns)

**Rule**: Each module/function should handle ONE concern. Different concerns should live in different modules.

#### Layered Architecture (Required Pattern)

```
routes/        → HTTP request/response, route definitions (THIN)
  ↓ delegates to
controllers/   → Request validation, response formatting (optional layer)
  ↓ delegates to
services/      → Business logic, orchestration
  ↓ delegates to
db/            → Data access, database queries
utils/         → Pure functions, helpers (no side effects)
middleware/    → Cross-cutting concerns (auth, logging, errors)
```

#### What Belongs Where

| Layer           | Responsibilities                             | Should NOT Do                          |
| --------------- | -------------------------------------------- | -------------------------------------- |
| **Routes**      | Define endpoints, attach middleware          | Business logic, DB queries             |
| **Controllers** | Parse req, validate input, format response   | Complex logic, direct DB access        |
| **Services**    | Business rules, orchestration, transactions  | HTTP concerns, response formatting     |
| **DB/Models**   | Queries, data access, schema                 | Business logic, HTTP concerns          |
| **Utils**       | Pure functions, formatting, calculations     | Side effects, DB access, HTTP          |
| **Middleware**  | Auth, logging, rate limiting, error handling | Business logic specific to one feature |

#### SoC Examples

```javascript
// ❌ BAD: Everything in route (violation of SoC)
app.post('/api/lists', async (req, res) => {
  try {
    // Validation mixed with business logic
    if (!req.body.name || req.body.name.length < 3) {
      return res.status(400).json({ error: 'Name too short' });
    }

    // Database logic in route
    const existingList = await db.query(
      'SELECT * FROM lists WHERE user_id = ? AND name = ?',
      [req.user.id, req.body.name]
    );

    if (existingList.length > 0) {
      return res.status(409).json({ error: 'List already exists' });
    }

    // Business logic in route
    const isPremium = req.user.subscription === 'premium';
    const maxLists = isPremium ? 100 : 10;
    const userLists = await db.query(
      'SELECT COUNT(*) as count FROM lists WHERE user_id = ?',
      [req.user.id]
    );

    if (userLists[0].count >= maxLists) {
      return res.status(403).json({ error: 'List limit reached' });
    }

    // More DB logic
    await db.query(
      'INSERT INTO lists (user_id, name, created_at) VALUES (?, ?, ?)',
      [req.user.id, req.body.name, new Date()]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GOOD: Proper separation of concerns
// routes/lists.js (THIN - only routing)
const listService = require('../services/list-service');
const { validateListCreation } = require('../validators');

app.post('/api/lists', ensureAuthAPI, async (req, res, next) => {
  try {
    validateListCreation(req.body); // Validation layer
    const list = await listService.createList(req.user, req.body); // Service layer
    res.json({ success: true, list }); // Response formatting
  } catch (err) {
    next(err); // Error middleware handles formatting
  }
});

// services/list-service.js (Business logic)
const listRepository = require('../db/list-repository');

async function createList(user, data) {
  // Business rule: Check for duplicate
  const exists = await listRepository.findByUserAndName(user.id, data.name);
  if (exists) {
    throw new ConflictError('List already exists');
  }

  // Business rule: Check limits
  const count = await listRepository.countUserLists(user.id);
  const maxLists = user.subscription === 'premium' ? 100 : 10;
  if (count >= maxLists) {
    throw new ForbiddenError('List limit reached');
  }

  // Delegate data access
  return await listRepository.create(user.id, data);
}

module.exports = { createList };

// db/list-repository.js (Data access only)
async function findByUserAndName(userId, name) {
  return db.query(
    'SELECT * FROM lists WHERE user_id = ? AND name = ? LIMIT 1',
    [userId, name]
  );
}

async function countUserLists(userId) {
  const result = await db.query(
    'SELECT COUNT(*) as count FROM lists WHERE user_id = ?',
    [userId]
  );
  return result[0].count;
}

async function create(userId, data) {
  return db.query(
    'INSERT INTO lists (user_id, name, created_at) VALUES (?, ?, ?)',
    [userId, data.name, new Date()]
  );
}

module.exports = { findByUserAndName, countUserLists, create };
```

#### SoC Checklist Before Committing

- [ ] Routes are thin (< 15 lines, mostly delegation)
- [ ] Business logic is in service layer
- [ ] Database queries are in repository/db layer
- [ ] Validation is in validators or middleware
- [ ] No HTTP concerns (req/res) in services or db layer
- [ ] No business logic in routes or middleware

### SOLID Principles

#### S - Single Responsibility Principle

**Rule**: A module/function should have ONE reason to change.

```javascript
// ❌ BAD: Multiple responsibilities
function handleUserRegistration(userData) {
  // Responsibility 1: Validation
  if (!userData.email) throw new Error('Email required');

  // Responsibility 2: Password hashing
  const hash = bcrypt.hashSync(userData.password, 10);

  // Responsibility 3: Database insertion
  db.query('INSERT INTO users ...');

  // Responsibility 4: Email sending
  sendWelcomeEmail(userData.email);

  // Responsibility 5: Logging
  logger.info('User registered', { email: userData.email });
}

// ✅ GOOD: Single responsibility per function
function registerUser(userData) {
  const validatedData = validateUserData(userData); // Validation concern
  const hashedPassword = hashPassword(validatedData.password); // Security concern
  const user = createUserInDB({ ...validatedData, password: hashedPassword }); // Persistence concern
  queueWelcomeEmail(user.email); // Email concern (async)
  logUserRegistration(user); // Logging concern
  return user;
}
```

**How to identify violations:**

- Function does 3+ distinct operations
- Function name contains "and" or "then"
- Changes to unrelated features require modifying this function

#### O - Open/Closed Principle

**Rule**: Code should be open for extension, closed for modification.

```javascript
// ❌ BAD: Must modify function to add new payment types
function processPayment(order, type) {
  if (type === 'credit_card') {
    return processCreditCard(order);
  } else if (type === 'paypal') {
    return processPayPal(order);
  } else if (type === 'crypto') {
    return processCrypto(order);
  }
  // Adding new payment type requires modifying this function
}

// ✅ GOOD: Use strategy pattern - extend without modifying
const paymentStrategies = {
  credit_card: processCreditCard,
  paypal: processPayPal,
  crypto: processCrypto,
  // Add new strategies here without changing core logic
};

function processPayment(order, type) {
  const strategy = paymentStrategies[type];
  if (!strategy) {
    throw new Error(`Unknown payment type: ${type}`);
  }
  return strategy(order);
}

// To add new payment type, just add to the map:
paymentStrategies.bank_transfer = processBankTransfer; // Extension, not modification
```

#### L - Liskov Substitution Principle

**Rule**: Subtypes/implementations must be substitutable for their base types.

```javascript
// ❌ BAD: Violates LSP - UserRepository throws unexpected error
class Repository {
  async findById(id) {
    return db.query('SELECT * FROM table WHERE id = ?', [id]);
  }
}

class UserRepository extends Repository {
  async findById(id) {
    if (!id) throw new Error('ID required'); // Unexpected precondition!
    return db.query('SELECT * FROM users WHERE id = ?', [id]);
  }
}

// ✅ GOOD: Consistent behavior across implementations
class Repository {
  async findById(id) {
    if (!id) return null; // Consistent null handling
    return db.query('SELECT * FROM table WHERE id = ?', [id]);
  }
}

class UserRepository extends Repository {
  async findById(id) {
    if (!id) return null; // Same behavior as parent
    return db.query('SELECT * FROM users WHERE id = ?', [id]);
  }
}
```

#### I - Interface Segregation Principle

**Rule**: Don't force modules to depend on methods they don't use.

```javascript
// ❌ BAD: Fat interface - forces all implementations to have all methods
class DataStore {
  save(data) {}
  find(id) {}
  update(id, data) {}
  delete(id) {}
  backup() {}
  restore() {}
  migrate() {}
  // Read-only stores don't need save/update/delete
  // Simple stores don't need backup/restore/migrate
}

// ✅ GOOD: Segregated interfaces - compose only what you need
class Readable {
  find(id) {}
}

class Writable {
  save(data) {}
  update(id, data) {}
  delete(id) {}
}

class Backupable {
  backup() {}
  restore() {}
}

// Implementations pick what they need
class ReadOnlyCache extends Readable {
  find(id) {
    return cache.get(id);
  }
}

class DatabaseStore extends Readable {
  constructor() {
    super();
    Object.assign(this, new Writable(), new Backupable());
  }
  // Implement all methods from composed interfaces
}
```

#### D - Dependency Inversion Principle

**Rule**: Depend on abstractions (interfaces), not concrete implementations. High-level modules should not depend on low-level modules.

**This project uses Dependency Injection pattern (see "Writing Testable Code" section) to implement DIP.**

```javascript
// ❌ BAD: Direct dependency on concrete implementation
// services/user-service.js
const PostgresDB = require('../db/postgres'); // Concrete dependency

async function createUser(data) {
  const db = new PostgresDB(); // Tightly coupled to Postgres
  return db.insert('users', data);
}

// ✅ GOOD: Depend on abstraction via dependency injection
// services/user-service.js
function createUserService(deps = {}) {
  const db = deps.db || require('../db'); // Abstraction - any DB implementation

  async function createUser(data) {
    return db.insert('users', data); // Works with any DB that implements insert()
  }

  return { createUser };
}

const defaultInstance = createUserService();
module.exports = { createUserService, ...defaultInstance };

// Now you can inject ANY database implementation:
// - Production: PostgreSQL
// - Testing: In-memory mock
// - Future: MongoDB, Redis, etc.
```

#### SOLID Checklist Before Committing

- [ ] Each function/module has one clear responsibility (SRP)
- [ ] New features added via extension, not modification (OCP)
- [ ] Implementations are substitutable without surprises (LSP)
- [ ] Modules don't depend on unused methods (ISP)
- [ ] Dependencies are injected, not hardcoded (DIP)

### Code Organization Patterns

#### File/Folder Structure

```
routes/           # HTTP routing only (THIN)
├── auth.js       # Authentication routes
├── lists.js      # List management routes
└── api.js        # API endpoint aggregation

services/         # Business logic (CORE)
├── auth-service.js
├── list-service.js
└── spotify-service.js

db/               # Data access layer
├── repositories/
│   ├── user-repository.js
│   └── list-repository.js
├── migrations/
└── index.js      # DB connection pool

utils/            # Pure functions, helpers
├── validators.js # Input validation
├── formatters.js # Data formatting
├── constants.js  # Application constants
└── logger.js     # Logging utility

middleware/       # Cross-cutting concerns
├── auth.js       # Authentication middleware
├── rate-limit.js # Rate limiting
├── error-handler.js
└── security.js   # CSRF, headers, etc.
```

#### When to Create a New File

- **New feature/domain**: Create new service + repository
- **Shared logic**: Extract to `utils/` if pure function, `services/` if has side effects
- **Cross-cutting concern**: Add to `middleware/`
- **File > 300 lines**: Consider splitting by responsibility

#### When to Refactor

Refactor immediately when you notice:

1. **Code duplication** (2+ occurrences of 3+ lines)
2. **Function > 50 lines** (break into smaller functions)
3. **File > 300 lines** (split by responsibility)
4. **Deep nesting** (> 3 levels of if/for/try)
5. **God objects** (class/module doing too much)
6. **Tight coupling** (module directly accessing internals of another)

### Anti-Patterns to Avoid

#### ❌ God Objects/Functions

```javascript
// BAD: One function doing everything
async function handleUserAction(req, res) {
  // 200+ lines of validation, business logic, DB access, email sending...
}

// GOOD: Orchestrate smaller, focused functions
async function handleUserAction(req, res) {
  const validated = validateInput(req.body);
  const result = await userService.performAction(validated);
  await notificationService.notify(result);
  return formatResponse(result);
}
```

#### ❌ Tight Coupling

```javascript
// BAD: Direct access to internals
class UserService {
  updateUser(id, data) {
    // Directly accessing db internals
    global.db.connection.query('UPDATE users...');
  }
}

// GOOD: Depend on abstraction
function createUserService(deps = {}) {
  const db = deps.db || require('../db');

  async function updateUser(id, data) {
    return db.update('users', id, data); // Abstract interface
  }

  return { updateUser };
}
```

#### ❌ Callback Hell / Promise Chains

```javascript
// BAD: Nested callbacks
doSomething(function (result) {
  doSomethingElse(result, function (newResult) {
    doThirdThing(newResult, function (finalResult) {
      // ...
    });
  });
});

// GOOD: Async/await
async function processData() {
  const result = await doSomething();
  const newResult = await doSomethingElse(result);
  const finalResult = await doThirdThing(newResult);
  return finalResult;
}
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

| Level     | When to Use                                  | Examples                                                                |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| **ERROR** | Unexpected failures requiring attention      | Database connection failures, unhandled exceptions, critical API errors |
| **WARN**  | Expected errors or concerning events         | Failed login attempts, rate limit hits, deprecated feature usage        |
| **INFO**  | Normal application flow (production default) | Server startup, user registration, major operations, admin actions      |
| **DEBUG** | Detailed diagnostic info (development only)  | SQL queries, cache details, step-by-step flow                           |

### Structured Logging Patterns

Always use objects for metadata instead of string interpolation:

```javascript
// ❌ BAD: String interpolation
logger.info('User logged in:', email);
logger.error('Database error:', err);

// ✅ GOOD: Structured objects
logger.info('User logged in', { email, userId: user._id, requestId: req.id });
logger.error('Database query failed', {
  error: err.message,
  stack: err.stack,
  operation: 'findOne',
});
```

### Standard Patterns by Event Type

#### Authentication Events

```javascript
// Login attempt
logger.info('Login attempt', { email, ip: req.ip, requestId: req.id });

// Success
logger.info('User logged in', { userId: user._id, email, requestId: req.id });

// Failure (use warn, not error)
logger.warn('Login failed', {
  email,
  reason: 'invalid_credentials',
  requestId: req.id,
});
```

#### Database Operations

```javascript
// Slow queries (>100ms)
logger.warn('Slow database query', {
  operation: 'findWithAlbumData',
  duration_ms: elapsed,
  listId,
});

// Database errors
logger.error('Database operation failed', {
  operation: 'insert',
  table: 'users',
  error: err.message,
});
```

#### External API Calls

```javascript
// API requests
logger.debug('External API request', {
  service: 'spotify',
  endpoint: '/v1/me',
});

// API responses
logger.info('External API response', {
  service: 'spotify',
  status: 200,
  duration_ms: elapsed,
});

// API errors (warn for 4xx, error for 5xx)
logger.warn('External API rate limited', {
  service: 'spotify',
  status: 429,
  retryAfter: headers['retry-after'],
});
```

#### Admin Actions (Audit Trail)

```javascript
logger.info('Admin action', {
  action: 'approve_user',
  adminId: req.user._id,
  targetUserId: userId,
  ip: req.ip,
});
```

#### Security Events

```javascript
// Rate limiting
logger.warn('Rate limit exceeded', {
  ip: req.ip,
  endpoint: req.path,
  userId: req.user?._id,
});

// CSRF failures
logger.warn('CSRF token validation failed', {
  requestId: req.id,
  ip: req.ip,
  endpoint: req.path,
});
```

### Child Loggers for Request Context

Use child loggers to bind context throughout request lifecycle:

```javascript
app.post('/api/lists/:id', ensureAuthAPI, async (req, res) => {
  const requestLogger = logger.child({
    requestId: req.id,
    userId: req.user._id,
    listId: req.params.id,
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

- **Commit messages**: Write clear, meaningful commits that describe what changed and why
- **Structure**: Start with a straightforward summary, then use bullet points for detailed changes
- **Tone**: Informal and conversational, but clear and to the point
- **Examples**:
  - "Clean up linting errors - reduced from 500+ to 13 remaining"
  - "Fix authentication bug causing session loss"
  - "Add database migrations for schema versioning"
  - "Fix memory leak in background job processor"
  - "Refactor API endpoints to reduce response payload size"
