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
- Tests sohuld always pass beforeon fix tests first