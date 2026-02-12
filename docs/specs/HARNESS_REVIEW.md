# Harness Review & Tooling Improvement Spec

> Sources: [pi coding agent](https://shittycodingagent.ai/), [Mario Zechner's pi blog post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/), [The Harness Problem (Can Bölük)](https://blog.can.ac/2026/02/12/the-harness-problem/), [oh-my-pi fork](https://github.com/can1357/oh-my-pi)

---

## 1. Pi Harness: What It Does Well vs Claude Code Wrapper

### Where Pi Wins

| Area | Pi Approach | Claude Code Wrapper Gap |
|------|------------|------------------------|
| **System prompt** | <1,000 tokens, sparse — trusts frontier models | Claude Code injects massive hidden context, breaks cache, unpredictable behavior |
| **Context control** | User controls exactly what enters context; skills loaded on-demand | Wrapper inherits CC's opaque context injection (sub-agent work, compaction, background) |
| **Observability** | Every interaction inspectable — no hidden sub-agents, no invisible compaction | CC hides sub-agent work, compaction details, tool schemas; wrapper can't surface what CC hides |
| **Session management** | Tree-structured history in single files, branch from any point, HTML/gist export | CC sessions are ephemeral; wrapper relies on handoff capture which is lossy |
| **Provider flexibility** | 15+ providers, mid-session switching with `Ctrl+P`, cross-provider context handoff | CC is Anthropic-only; wrapper locked to Claude models |
| **Extensibility** | TypeScript extensions with full TUI access; 50+ examples | CC hooks are limited (pre/post tool); no TUI access, no custom rendering |
| **File-based state** | Plans, todos, context as files in version control (PLAN.md, checkboxed markdown) | CC's plan mode and todos are ephemeral UI state — lost on session end |
| **No permission theater** | YOLO by default — honest about security model ("if it can read + execute, game over") | CC's permission popups provide false security, interrupt flow |
| **Progressive disclosure** | Agent reads docs on-demand, pays token cost only when needed | CC loads CLAUDE.md/rules upfront into every prompt cache |

### Where Claude Code Wrapper Still Wins

| Area | CC Advantage |
|------|-------------|
| **Ecosystem** | Built-in MCP, GitHub integration, web search, browser tools |
| **Safety for teams** | Permission model matters for shared/org contexts |
| **Sub-agents** | CC's Task tool with typed agents (explore, plan, debug) is production-ready |
| **Anthropic model optimization** | Tight integration with Claude's thinking, caching, tool use |
| **Onboarding** | Zero config to start; pi requires more setup for equivalent capability |

### Key Takeaway

Pi's philosophy: **"context engineering is the whole game"** — the harness should maximize user control over what enters the model's context window. Claude Code optimizes for ease-of-use at the cost of transparency.

---

## 2. Tooling Improvements (from Zechner's Blog)

### High-Priority Changes

#### 2a. Minimal System Prompt
- **Current**: StackMemory wrapper inherits CC's bloated system prompt + CLAUDE.md + MEMORY.md
- **Action**: Audit total token cost of system prompt. Target: context overhead visible to user, lazy-load non-essential instructions
- **Pattern**: Skills/rules loaded on-demand, not upfront

#### 2b. File-Based Planning Over Ephemeral Modes
- **Current**: CC plan mode is ephemeral — plan disappears after approval
- **Action**: Write plans to `PLAN.md` in project root. Persist across sessions. Agent references and updates like any file
- **Benefit**: Version controlled, collaborative, survives session restarts

#### 2c. Context Gathering as Separate Phase
- **Insight**: "Models are bad at context gathering — they miss important context and hesitate to read entire files"
- **Action**: Dedicated `gather` command that reads relevant files into a context manifest before coding starts
- **Pattern**: Manual upfront context > mid-session discovery

#### 2d. Progressive Disclosure for Tools
- **Current**: All MCP tools, skills, and rules loaded into prompt cache
- **Action**: Tools registered with description only; full schema injected on first use
- **Savings**: MCP servers add 7-9% context overhead (13.7k-18k tokens) per session for rarely-used tools

#### 2e. Explicit Sub-Agent Spawning
- **Insight**: "Mid-session sub-agents indicate poor context planning"
- **Action**: When sub-agents are needed, spawn via tmux/bash for full transparency — no hidden parallel work
- **Benefit**: User can observe, interrupt, or redirect any sub-agent

### Medium-Priority Changes

#### 2f. Session Export
- **Action**: Export sessions as HTML/markdown/gist for sharing and post-processing
- **Use case**: Code review, team handoff, debugging session replay

#### 2g. Structured Tool Results
- **Pattern**: Tools return both LLM-facing text AND UI-displayable content separately
- **Benefit**: Eliminates parsing text in UI code; cleaner rendering

#### 2h. Cross-Provider Context Handoff
- **Pi approach**: Converts thinking traces to `<thinking>` tags when switching providers
- **Action**: If we ever support multiple providers, design context format that's provider-agnostic

---

## 3. The Harness Problem — Strategies

### Core Insight

> "Models aren't flaky at understanding tasks. They're flaky at expressing themselves. You're blaming the pilot for the landing gear."

The edit format is the bottleneck. Not the model.

### Current Edit Landscape (Problems)

| Format | Failure Mode | Who Uses It |
|--------|-------------|-------------|
| **Patch/diff** | 50.7% failure on Grok 4; requires exact diff syntax | OpenAI/Codex |
| **String replace** | "String not found" when whitespace differs; rejects on multiple matches | Claude Code, Gemini |
| **Neural merge** | Throws another 70B model at the problem; admits full rewrite beats diff for <400 lines | Cursor |

### Hashline Approach (Can Bölük)

Tag each line with a 2-3 char content hash:
```
11:a3|function hello() {
22:f1|  return "world";
33:0e|}
```

**Results**:
- Grok Code Fast: 6.7% → 68.3% success (10x improvement)
- Output tokens down ~61% (fewer retries)
- Weakest models showed greatest gains
- Gemini +8% — bigger than typical model upgrade

### Strategies for StackMemory Tooling

#### Strategy 1: Hashline Edit Tool
- **What**: Implement hashline-tagged file content in our edit tool
- **Why**: Eliminates whitespace reproduction failures, the #1 edit failure mode
- **Cost**: Low — pure harness change, no model changes needed
- **Risk**: Adds token overhead per line (2-3 chars + separator); negligible for files <1000 lines

#### Strategy 2: Fuzzy Edit Matching (oh-my-pi approach)
- **What**: High-confidence fuzzy matching for `oldText` in edit operations
- **Why**: Handles invisible whitespace/indentation variance automatically
- **Cost**: Low — edit tool change only
- **Risk**: False positive matches on similar-looking code; mitigated by confidence threshold
- **Note**: oh-my-pi ships this as `edit.fuzzyMatch` (enabled by default)

#### Strategy 3: Adaptive Format Selection
- **What**: Choose edit format based on which model is running
- **Why**: "No single edit format dominates across models"
- **Cost**: Medium — need to maintain multiple edit tool implementations
- **Risk**: Complexity; but we're Anthropic-only so may not matter yet

#### Strategy 4: Edit Failure Recovery
- **What**: On "string not found" error, automatically retry with normalized whitespace or show diff to user
- **Why**: Reduces retry loops that burn tokens
- **Cost**: Low — error handler in edit tool
- **Pattern**: oh-my-pi's fuzzy match is the automatic version of this

#### Strategy 5: Full-File Rewrite for Small Files
- **What**: For files <400 lines, prefer full-file Write over surgical Edit
- **Why**: Cursor's own research shows full rewrites outperform diffs for small files
- **Cost**: More output tokens, but higher reliability
- **Trigger**: Could auto-select based on file size

### Meta-Strategy: Measure Edit Failure Rates
- **What**: Log every edit tool call, track success/failure/retry rates
- **Why**: Can't optimize what you can't measure; Bölük spent $300 on benchmarking and found 10x improvements
- **Action**: Add telemetry to edit operations — success rate, retry count, token waste from failures

---

## 4. oh-my-pi Fork — Notable Additions

### Features Worth Studying

| Feature | What It Does | Relevance to StackMemory |
|---------|-------------|-------------------------|
| **TTSR (Time-Traveling Streamed Rules)** | Rules inject via regex trigger on model output stream; zero context cost until activated | Could apply to skills/rules — don't load until model starts writing relevant code |
| **LSP Integration** | Format-on-write, diagnostics after every edit, 40+ languages | Catches errors immediately rather than at lint step; tighter feedback loop |
| **Native Rust Engine** | 7,500 lines of Rust via N-API: grep, shell, text, glob, highlight | Performance-critical ops without shelling out; we use `better-sqlite3` similarly |
| **Universal Config Discovery** | Loads config from 8 AI tools (Claude, Cursor, Windsurf, Gemini, etc.) | Interesting for multi-tool users; not our priority |
| **Edit Fuzzy Matching** | Auto-handles whitespace variance in edits | Directly addresses harness problem Strategy 2 |
| **Model Roles** | default/smol/slow with auto-discovery | Cost optimization; use cheap models for exploration, expensive for coding |
| **Isolated Task Execution** | Tasks run in git worktrees, generate patches | Safe parallel work without branch conflicts |
| **Multi-Credential Round-Robin** | Cycles API keys, falls back on rate limits | Useful for high-volume usage |
| **Python IPython Kernel** | Persistent Python session with 30+ helpers | Data analysis, scripting within agent context |
| **Bash Interceptor** | Blocks shell commands that have dedicated tools | Forces model to use structured tools over raw bash |

### Architecture Decisions Worth Adopting

1. **Bun runtime** — faster startup, native TS execution (we use Node + esbuild)
2. **SQLite-backed prompt history** — searchable cross-session (we already have SQLite infra)
3. **Crash handler terminal restore** — prevents corrupted terminal state
4. **Grouped tool display** — consecutive Read calls shown as compact tree (UX improvement)
5. **Auto session titles** — use smol model to title sessions from first message

---

## 5. Priority Actions

### Immediate (This Week)
1. **Audit context overhead** — measure total tokens injected before user's first message
2. **Log edit failure rates** — instrument Edit tool with success/failure/retry telemetry
3. **Implement edit fuzzy matching** — handle whitespace variance (Strategy 2)

### Short-Term (This Month)
4. **TTSR-style lazy rule loading** — rules/skills inject only when triggered by model output patterns
5. **File-based planning** — persist PLAN.md instead of ephemeral plan mode
6. **Session export** — markdown/HTML export for handoff and review

### Medium-Term (Next Quarter)
7. **Hashline edit tool** — implement and benchmark against string-replace (Strategy 1)
8. **Progressive tool disclosure** — register tools with descriptions only, full schema on first use
9. **LSP integration** — format-on-write + diagnostics after edit for tighter feedback loops
10. **Edit telemetry dashboard** — track and visualize edit success rates over time

---

## 6. Deep Dive: Rust N-API Native Engine (oh-my-pi)

### Why This Matters

oh-my-pi replaced 13 categories of shell-out operations with ~7,500 lines of Rust compiled to platform-tagged N-API addons. This is the most architecturally significant difference from both pi and Claude Code — it eliminates process spawning overhead for every core operation.

### Module-by-Module Analysis

#### grep (~1,300 lines) — Powered by ripgrep internals
- Uses `grep-regex`, `grep-searcher`, `grep-matcher` (the actual ripgrep engine, not a wrapper)
- Parallel and sequential search modes
- Glob/type filtering, context lines, fuzzy find for autocomplete
- **Why it matters**: Every `Grep` tool call in Claude Code spawns `rg` as a subprocess. In-process grep eliminates ~5-15ms per call of process creation overhead. For agents that grep hundreds of times per session, this adds up.
- **StackMemory relevance**: Our search already uses `better-sqlite3` (native addon) for FTS5. Could extend the pattern — native grep for file-based search before content enters SQLite.

#### shell (~1,025 lines) — Powered by brush-shell (vendored)
- Embedded bash execution with **persistent sessions** — no `execSync`/`spawn` per command
- Streaming stdout/stderr with timeout/abort
- Custom builtins (can inject host-side functions into bash namespace)
- **Why it matters**: Persistent bash sessions mean environment variables, working directory, and shell state survive across commands. No more `cd` being ephemeral. No more `execSync` blocking the event loop (our known gotcha).
- **Critical insight**: This solves our documented problem — "execSync blocks the Node event loop — vitest test-level timeouts can't fire." A persistent async shell session would fix this class of bugs entirely.

#### text (~1,280 lines) — ANSI-aware text processing
- Visible width calculation, truncation with ellipsis, column slicing
- Text wrapping that preserves SGR codes across line breaks
- UTF-16 optimized
- **Why it matters**: Terminal rendering correctness. ANSI escape codes break naive `string.length` calculations. CJK characters are double-width. This ensures UI components measure and wrap text correctly.
- **StackMemory relevance**: Low priority for us — we're not building a TUI. But relevant if we ever add rich terminal output.

#### keys (~1,300 lines) — Kitty keyboard protocol
- Full Kitty keyboard protocol parser with legacy xterm/VT100 fallback
- Modifier support, PHF (perfect hash function) lookup for key mapping
- **StackMemory relevance**: None directly — this is TUI infrastructure.

#### highlight (~475 lines) — Syntax highlighting
- 11 semantic color categories, 30+ language aliases
- Powered by `syntect` (the standard Rust syntax highlighting library)
- **Why it matters**: In-process highlighting without spawning `bat` or `pygmentize`.
- **StackMemory relevance**: Low — but could be useful for diff display or code review features.

#### glob (~340 lines) — Filesystem discovery
- Glob patterns, type filtering, mtime sorting
- `.gitignore` respect built-in
- Powered by `ignore` and `globset` (also ripgrep internals)
- **Why it matters**: Like grep, eliminates process spawning for file discovery. Respecting `.gitignore` natively means no accidental `node_modules` scanning.
- **StackMemory relevance**: Medium — our file watch service could benefit from native glob rather than `chokidar` or `fs.watch` wrappers.

#### task (~350 lines) — Work scheduler
- Blocking work scheduler on libuv thread pool
- Cooperative and external cancellation, timeout, profiling hooks
- Powered by `tokio` + `napi`
- **Why it matters**: Runs CPU-intensive work on libuv worker threads without blocking the main event loop. Proper cancellation semantics (not just `process.kill()`).
- **StackMemory relevance**: High — our daemon services could use this pattern for CPU-intensive operations (embedding generation, large search operations) instead of child processes.

#### ps (~290 lines) — Process tree management
- Cross-platform process tree kill and descendant listing
- `/proc` on Linux, `libproc` on macOS, `CreateToolhelp32Snapshot` on Windows
- **Why it matters**: Killing a process tree correctly is notoriously hard in Node.js. `process.kill()` doesn't kill children. `tree-kill` npm package is unreliable.
- **StackMemory relevance**: Medium — daemon process management could use reliable tree kill.

#### prof (~250 lines) — Always-on profiler
- Circular buffer profiler with folded-stack output
- Optional SVG flamegraph generation via `inferno`
- **Why it matters**: Always-on with negligible overhead. Can diagnose performance issues without reproducing them under a profiler.
- **StackMemory relevance**: Nice-to-have for daemon performance debugging.

#### system_info (~170 lines) — System metadata
- Distro, kernel, CPU, disk usage without shelling out
- **StackMemory relevance**: Low — could enrich context frames with system state.

#### image (~150 lines) / clipboard (~95 lines) / html (~50 lines)
- Image: decode/encode PNG/JPEG/WebP/GIF, resize with 5 sampling filters
- Clipboard: text copy and image read without `xclip`/`pbcopy`
- HTML: HTML-to-Markdown conversion
- **StackMemory relevance**: Low. HTML-to-markdown could help with web content capture.

### Architecture Patterns Worth Adopting

#### Pattern 1: N-API for Hot Paths
We already use `better-sqlite3` (C++ N-API addon). The pattern extends naturally:
```
Current (spawn subprocess):     Node → fork() → execve("rg") → pipe → parse
Native (N-API in-process):      Node → napi_call → rust fn → return
```
Savings: ~5-15ms per call (process creation) + ~2-5ms (pipe serialization)

#### Pattern 2: Persistent Shell Sessions
```
Current:  execSync("cd /foo && git status")  // blocks event loop, state lost
Native:   shell.execute("cd /foo")           // async, state persists
          shell.execute("git status")         // still in /foo
```
Solves: event loop blocking, ephemeral state, timeout issues

#### Pattern 3: Libuv Thread Pool for CPU Work
```
Current:  worker_threads or child_process for CPU-intensive ops
Native:   task.schedule(() => heavyComputation())  // runs on libuv pool
          // main thread stays responsive
          // proper cancellation via AbortController
```

### Build Considerations

| Factor | Impact |
|--------|--------|
| **Binary size** | N-API addon adds ~5-15MB per platform |
| **Build complexity** | Requires Rust toolchain + `napi-rs` for compilation |
| **Cross-compilation** | Need CI matrix for linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64 |
| **Distribution** | Platform-tagged npm packages (`@stackmemory/natives-darwin-arm64`, etc.) |
| **Fallback** | Must gracefully degrade when native addon unavailable (like we do with sqlite-vec) |

### Recommendation

**Phase 1 (Low effort, high impact)**: Adopt the persistent shell session pattern using existing Node.js primitives (`child_process.spawn` with persistent stdin/stdout) before committing to Rust. This solves the `execSync` blocking problem without build complexity.

**Phase 2 (Medium effort)**: If search performance becomes a bottleneck, native grep via N-API. We already have the `better-sqlite3` precedent for native addons in the build.

**Phase 3 (High effort, evaluate ROI)**: Full native engine only if profiling shows subprocess overhead is a significant fraction of total latency. For a context management tool (not a TUI), the overhead may be acceptable.
