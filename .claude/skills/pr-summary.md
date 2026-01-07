---
description: Generate a summary for the current branch changes
allowed-tools: Bash(git:*)
---

# PR Summary

Generate a pull request summary for the current branch.

## Instructions

1. **Analyze changes**:
   ```bash
   git log main..HEAD --oneline
   git diff main...HEAD --stat
   ```

2. **Extract Linear tickets**:
   ```bash
   git log main..HEAD | grep -E "STA-[0-9]+"
   ```

3. **Generate summary** with:
   - Phase implementation status
   - Performance metrics
   - Breaking changes (if any)
   - Linear tickets addressed

4. **Format as PR body**:
   ```markdown
   ## Summary
   - [Phase X feature/fix]
   - Performance: [XXXms operations]
   - Linear: STA-XX

   ## Changes
   - [List of significant changes]

   ## Test Plan
   - [ ] Unit tests pass (XXX tests)
   - [ ] Integration tests pass
   - [ ] Performance benchmarks run
   - [ ] Manual testing completed

   ## Breaking Changes
   - None / [List if any]
   ```