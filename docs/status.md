# Status

- Hosted: Private beta
- OSS mirror: Production ready
- MCP integration: Stable
- CLI: v0.5.51 — Zero-config setup, diagnostics, full task/context/Linear management
- Two-tier storage: Complete
- Test Suite: 480 tests passing

## Test Mode

To run tests in constrained environments or avoid native module initialization during CLI/harness execution, enable test mode. When enabled, the CLI skips opening the local SQLite DB and avoids writing frames/anchors in helper commands.

- Env flags:
  - `VITEST=true`: Detected automatically by the CLI; disables DB work in commands like `init`, `status`, and `context:test`.
  - `NODE_ENV=test`: Also triggers DB‑skip behavior.
  - `STACKMEMORY_TEST_SKIP_DB=1`: Explicit override to skip DB, independent of test runner.

- Typical usage:
  - `VITEST=true npm run test:run`
  - `STACKMEMORY_TEST_SKIP_DB=1 npm run test:run`

This keeps unit tests fast and stable across sandboxes. Regular usage (without these flags) fully initializes and uses the local `.stackmemory/context.db`.
