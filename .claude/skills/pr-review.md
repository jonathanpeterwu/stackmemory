---
description: Review a pull request using project standards
allowed-tools: Read, Glob, Grep, Bash(git:*), Bash(gh:*)
---

# PR Review

Review the pull request: $ARGUMENTS

## Instructions

1. **Get PR information**:
   - Run `gh pr view $ARGUMENTS` to get PR details
   - Run `gh pr diff $ARGUMENTS` to see changes

2. **Apply StackMemory standards**:
   - ESM imports with `.js` extension
   - Context bridge handling for CLI
   - Frame lifecycle management
   - Error handling patterns (return undefined)
   - Database path conventions
   - Linear ticket references

3. **Check for**:
   - TypeScript strict mode compliance
   - Test coverage for changes
   - Performance impact
   - Breaking changes
   - Documentation updates

4. **Provide structured feedback**:
   - **Critical**: Must fix before merge
   - **Warning**: Should fix
   - **Suggestion**: Nice to have

5. **Post review comments** using `gh pr comment`