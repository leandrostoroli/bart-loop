## Testing
### tdd
Write a failing test first. Implement the minimal code to make it pass. Refactor.
Never write production code without a failing test. Follow the red-green-refactor cycle:
1. Write a test that describes the expected behavior — run it, confirm it fails
2. Write the simplest code that makes the test pass
3. Refactor while keeping tests green
If modifying existing code, first write a test that captures the current behavior, then change the test to reflect the new behavior, then update the code.

### unit-tests
All new functions must have corresponding unit tests. Test edge cases and error paths, not just happy paths.
Each test should cover: valid input, boundary values, empty/null input, and expected error conditions.
Tests must be independent — no shared mutable state between tests. Use setup/teardown for isolation.
Name tests descriptively: describe what behavior is being tested, not the implementation.

## Code Quality
### error-handling
All external calls (APIs, file I/O, DB) must have explicit error handling with typed errors. Never swallow errors silently.
Use typed error classes rather than generic Error. Include context in error messages (what operation failed, with what inputs).
Propagate errors to callers — do not catch-and-ignore. Log errors at the boundary where they are handled, not where they are thrown.

### type-safety
No `any` types. All function signatures must have explicit return types.
Use discriminated unions for variant types. Prefer `unknown` over `any` when the type is truly not known.
Generic type parameters should have meaningful constraints. Avoid type assertions (`as`) — refactor the code to make the type flow naturally.

### logging
All error paths must log with structured context (not just error.message).
Include operation name, relevant identifiers, and timing information. Use consistent log levels:
- error: something failed and needs attention
- warn: something unexpected but recoverable
- info: significant state changes (start/complete operations)
- debug: detailed diagnostic information

## API
### api-contract
API changes must maintain backwards compatibility. Add contract tests for new endpoints.
New fields should be optional with sensible defaults. Removed fields must go through a deprecation period.
Version breaking changes explicitly. Document request/response schemas and error codes.

### input-validation
All user input and external data must be validated at system boundaries.
Validate type, format, length, and range. Return clear error messages that help callers fix invalid input.
Never trust data from external sources — validate even if the caller is internal. Sanitize before use in queries, commands, or output.

## UI
### accessibility
New UI components must pass axe-core accessibility audit.
All interactive elements must be keyboard-navigable. Images need alt text, form fields need labels, color must not be the only indicator.
Test with screen readers for critical user flows. Maintain WCAG 2.1 AA compliance.
