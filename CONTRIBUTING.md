# Contributing to StackMemory

Thanks for your interest in contributing to StackMemory!

## Getting Started

```bash
git clone https://github.com/stackmemoryai/stackmemory.git
cd stackmemory
npm install
npm run build
npm run test:run
```

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run validation: `npm run lint && npm run test:run && npm run build`
5. Commit with conventional format: `type(scope): message`
6. Open a pull request against `main`

## Commit Messages

Follow conventional commits:
- `feat(scope):` new feature
- `fix(scope):` bug fix
- `refactor(scope):` code restructuring
- `test(scope):` adding or updating tests
- `chore(scope):` maintenance tasks
- `docs(scope):` documentation changes

## Code Standards

- TypeScript strict mode is enabled
- ESM modules with `.js` extensions on relative imports
- Run `npm run lint` before committing (pre-commit hooks enforce this)
- New features require tests in `src/**/__tests__/`
- Maintain or improve test coverage

## Project Structure

```
src/
  cli/           # CLI commands and entry point
  core/          # Core business logic (context, database, query)
  integrations/  # External integrations (Linear, MCP)
  services/      # Business services
  utils/         # Shared utilities
```

## Testing

```bash
npm run test:run          # Run all tests once
npm test                  # Watch mode
npm run test:pre-publish  # Full pre-publish validation
```

## License

By contributing, you agree that your contributions will be licensed under the project's [BSL 1.1 license](./LICENSE).
