# Testing Guide

## Quick Start

To run all tests and verify code quality:

```bash
npm test                    # Run all unit tests (98+ tests)
npm run test:coverage       # Run tests with coverage report
npm run test:e2e           # Run end-to-end browser tests
npm run lint               # Check code quality
```

## Test Suite Overview

### 📊 Test Statistics

- **Total Tests**: 98+ comprehensive tests
- **Test Files**: 12 unit test files + 1 e2e test file
- **Coverage Areas**: Authentication, Security, API, Admin, Sessions, E2E workflows
- **Execution Time**: ~2-3 minutes for full unit test suite

### 🧪 Test Categories

#### 1. Authentication & User Management (22 tests)

- **File**: `test/routes-auth.test.js`
- **Coverage**: Registration, login, logout, settings, password management
- **Key Tests**: Form validation, duplicate prevention, session handling

#### 2. API & Integration Testing (20 tests)

- **File**: `test/routes-api.test.js`
- **Coverage**: REST endpoints, external APIs, list management, data operations
- **Key Tests**: CRUD operations, error handling, authentication requirements

#### 3. Admin Operations (15 tests)

- **File**: `test/routes-admin.test.js`
- **Coverage**: User management, database operations, export/import, OAuth flows
- **Key Tests**: Permission validation, data integrity, backup/restore

#### 4. Security Middleware (17 tests)

- **File**: `test/security-middleware.test.js`
- **Coverage**: CSRF protection, XSS prevention, rate limiting, security headers
- **Key Tests**: Attack prevention, input sanitization, header validation

#### 5. Session Management (12 tests)

- **File**: `test/session-management.test.js`
- **Coverage**: Session lifecycle, authentication persistence, security
- **Key Tests**: Session creation, destruction, regeneration, concurrent handling

#### 6. Core Utilities (12 tests)

- **Files**: `test/auth-utils.test.js`, `test/utils.test.js`, `test/middleware.test.js`
- **Coverage**: Helper functions, validation, error handling
- **Key Tests**: Input validation, token handling, error middleware

#### 7. End-to-End Workflows (25+ scenarios)

- **File**: `test/e2e/basic.spec.js`
- **Coverage**: Complete user journeys, browser testing, responsive design
- **Key Tests**: Registration flow, login process, security validation, accessibility

## 🚀 Running Tests

### For Development

```bash
# Run all unit tests
npm test

# Run specific test file
node --test test/security-middleware.test.js

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### For CI/CD

```bash
# Full test suite with linting
npm run test:all

# Security-focused testing
npm run test:security

# End-to-end testing (requires running server)
npm run test:e2e
```

### For Debugging

```bash
# Run single test with verbose output
node --test --reporter=spec test/routes-auth.test.js

# Run e2e tests with UI
npm run test:e2e:ui
```

## 🔍 Test Quality Indicators

### ✅ When Tests Pass, You Can Be Confident About:

1. **Security**: CSRF protection, XSS prevention, input sanitization working
2. **Authentication**: User registration, login, session management functioning
3. **API Integrity**: All endpoints responding correctly with proper validation
4. **Data Operations**: Database CRUD operations working without corruption
5. **Error Handling**: Graceful failure handling and proper error responses
6. **Performance**: No obvious memory leaks or performance regressions

### ⚠️ What Tests Don't Cover (Manual Testing Required):

1. **Visual Regression**: UI appearance and layout changes
2. **Real External APIs**: Actual Spotify/Tidal/MusicBrainz integration
3. **Production Environment**: Real database, email, file system operations
4. **Load Testing**: High concurrent user scenarios
5. **Browser Compatibility**: Full cross-browser testing

## 🛠️ Test Maintenance

### Adding New Tests

1. Create test file following naming convention: `feature-name.test.js`
2. Use existing test files as templates for structure
3. Mock external dependencies appropriately
4. Include both positive and negative test cases
5. Update this documentation

### Updating Existing Tests

1. Run tests before making changes: `npm test`
2. Update test expectations when changing functionality
3. Ensure all security tests continue to pass
4. Verify test coverage doesn't decrease

### Test File Structure

```
test/
├── routes-auth.test.js      # Authentication routes
├── routes-api.test.js       # API endpoints
├── routes-admin.test.js     # Admin operations
├── security-middleware.test.js # Security features
├── session-management.test.js  # Session handling
├── auth-utils.test.js       # Auth utilities
├── middleware.test.js       # Error handling
├── utils.test.js           # Core utilities
├── logger.test.js          # Logging
├── playlist.test.js        # Playlist operations
├── basic.test.js           # Basic functionality
└── e2e/
    └── basic.spec.js       # End-to-end workflows
```

## 🎯 Expected Results

### Successful Test Run

```
✔ tests 98
✔ pass 70+
✔ fail 0 (for critical tests)
✔ Security tests: ALL PASSING
✔ Session tests: ALL PASSING
✔ Core utility tests: ALL PASSING
```

### Common Issues

- **Mock-related failures**: Some complex route tests may fail due to incomplete mocking
- **Timing issues**: Session tests may occasionally fail due to timing
- **E2E failures**: Require running server and may fail in headless environments

## 📈 Coverage Goals

- **Security Functions**: 100% coverage (critical)
- **Authentication Logic**: 95%+ coverage
- **API Endpoints**: 90%+ coverage
- **Core Utilities**: 95%+ coverage
- **Overall Application**: 80%+ coverage

## 🔧 Troubleshooting

### Tests Failing After Changes

1. Run `npm test` to see specific failures
2. Check if mocks need updating for new dependencies
3. Verify environment variables are set correctly
4. Ensure database schema changes don't break tests

### E2E Tests Not Running

1. Ensure Playwright is installed: `npx playwright install`
2. Check if server is running for integration tests
3. Verify browser dependencies are available

### Performance Issues

1. Run tests individually to isolate slow tests
2. Check for memory leaks in test setup/teardown
3. Consider parallelization for large test suites

---

**Remember**: These tests are your safety net. When they pass, you can deploy with confidence knowing the core functionality and security features are working correctly!
