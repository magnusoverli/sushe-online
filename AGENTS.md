# AGENTS.md - Development Guidelines

## Commands

- **Build**: `npm run build` (builds CSS + JS)
- **Dev**: `npm run dev` (watch mode with nodemon)
- **Test**: `npm test` (runs all tests)
- **Single test**: `node --test test/filename.test.js`
- **Lint**: Add `eslint` and `prettier` for code quality (recommended)

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

- **Regression prevention**: Test core user flows (login, registration, data operations) after any changes
- **Manual testing**: Verify UI/UX changes in browser, test edge cases and error scenarios
- **Database integrity**: Ensure migrations don't break existing data, backup before schema changes
- **Performance monitoring**: Check for memory leaks, slow queries, and response time degradation

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
