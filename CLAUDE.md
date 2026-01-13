# CRITICAL: Code Validation Requirements
- Always run tests and lint and build after code change tasks are complete
- Always attempt to build and fix npm build issues after a task is complete
- Never fallback to mock or fake data - try to fix the actual error

# Validation Checklist (MUST DO):
1. Run `npm run lint` after any code changes
2. Run `npm test` to verify no regressions
3. Run `npm run build` to ensure compilation succeeds
4. Actually execute the code/command to confirm it works
5. If any step fails, fix it before proceeding
- Ensure whenever we create scripts, files, test, etc to place them in the correct folder based on the repo folder structure provided in the reposiutory
- Always review most recent commit to load context and stackmemory.json if possible as well as recent frames to remember session whenever claude code is loaded
- When syncing from linear fallback to using the api script if its not working
- always check .env for api keys first and .zsrhc before asking for it
- Whenever needing to test page builds use the browser mcp or chrome claude mcp extension, if you need to do visual research do it using browser mcp
- Remember to run npm run linear:sync whenever a task is complete or updated
- Never assume or skip testing - always run lint, tests, and build after code changes
- Always confirm code works by running it - don't just make a guess
- Ask questions if you get stuck or are not 100% certain about something
- Tests should always pass before proceeding - fix tests first

# Security Best Practices (CRITICAL):

## API Keys and Secrets Management
1. **NEVER hardcode API keys or secrets in code files**
   - Always use environment variables: `process.env.API_KEY`
   - Add dotenv/config import: `import 'dotenv/config'`
   - Check .env file first, then .zshrc/.bashrc
   
2. **When fixing hardcoded secrets:**
   - Replace with: `process.env.KEY_NAME || process.env.FALLBACK_KEY`
   - Add error handling:
     ```javascript
     if (!API_KEY) {
       console.error('❌ API_KEY environment variable not set');
       console.log('Please set API_KEY in your .env file or export it in your shell');
       process.exit(1);
     }
     ```
   - Always add `import 'dotenv/config'` at the top of scripts
   
3. **GitHub Push Protection Issues:**
   - If push is blocked due to secrets in OLD commits:
     - Option 1: Visit GitHub URLs to allow specific secrets (if they're being removed)
     - Option 2: Use BFG Repo-Cleaner to remove from history
     - Option 3: Interactive rebase to edit old commits
   - Prevention: Always check for secrets BEFORE committing with:
     - `git diff --staged | grep -E "(api_key|token|secret|password)"`
     - Use pre-commit hooks to scan for secrets
     
4. **Environment Variable Sources (check in order):**
   - .env file (for development)
   - .env.local (for local overrides)
   - ~/.zshrc or ~/.bashrc (for user-specific)
   - Process environment (for CI/CD)

## Common Secret Patterns to Watch For:
- `lin_api_*` - Linear API keys
- `lin_oauth_*` - Linear OAuth tokens  
- `sk-*` - OpenAI/Stripe keys
- `npm_*` - NPM tokens
- Any base64 encoded strings that look like tokens
- Hardcoded URLs with embedded credentials
- # Never use emojis and speak in plain developer english for comments not AI comments
- Ask 1-3 questions for clarity for any command given that is complex, go question by question
- Ask questions one at a time before moving on allow user to skip