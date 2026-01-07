---
description: Run code quality checks on a directory
allowed-tools: Read, Glob, Grep, Bash(npm:*), Bash(npx:*)
---

# Code Quality Review

Review code quality in: $ARGUMENTS

## Instructions

1. **Identify files to review**:
   - Find all `.ts` and `.tsx` files in the directory
   - Exclude test files and generated files

2. **Run automated checks**:
   ```bash
   npm run lint -- $ARGUMENTS
   npm run typecheck
   npm run test:run
   ```

3. **StackMemory-specific checklist**:
   - [ ] No TypeScript `any` types
   - [ ] ESM imports have `.js` extension
   - [ ] Frame lifecycle properly managed
   - [ ] Context bridge skipped for CLI operations
   - [ ] Error handling returns undefined, not throws
   - [ ] Database paths use project-local `.stackmemory/`
   - [ ] Frame digests under 200 tokens
   - [ ] Linear integration error handling

4. **Report findings** organized by severity:
   - Critical (must fix)
   - Warning (should fix)
   - Suggestion (could improve)