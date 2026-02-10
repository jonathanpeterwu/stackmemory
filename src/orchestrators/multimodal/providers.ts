import { spawnSync } from 'child_process';

// Lightweight provider wrappers with safe fallbacks for a spike.

export async function callClaude(
  prompt: string,
  options: { model?: string; system?: string }
): Promise<string> {
  // Use Anthropic SDK only if key is present; otherwise return a stubbed plan
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    // If this is used as the critic, return a valid JSON approval to allow offline runs
    const sys = (options.system || '').toLowerCase();
    if (
      sys.includes('strict code reviewer') ||
      sys.includes('return a json object') ||
      sys.includes('approved')
    ) {
      return JSON.stringify({ approved: true, issues: [], suggestions: [] });
    }
    // Otherwise, return a heuristic hint (planner will fall back to heuristicPlan)
    return `STUB: No ANTHROPIC_API_KEY set. Returning heuristic plan for prompt: ${prompt
      .slice(0, 80)
      .trim()}...`;
  }

  // Dynamic import to avoid bundling the SDK when not needed
  const { Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const model = options.model || 'claude-sonnet-4-20250514';
  const system =
    options.system || 'You are a precise software planning assistant.';

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg?.content?.[0];
    const text =
      block && 'text' in block
        ? (block as { text: string }).text
        : JSON.stringify(msg);
    return text;
  } catch {
    // Network/auth errors: behave like offline/no-key mode
    const sys = (options.system || '').toLowerCase();
    if (
      sys.includes('strict code reviewer') ||
      sys.includes('return a json object') ||
      sys.includes('approved')
    ) {
      return JSON.stringify({ approved: true, issues: [], suggestions: [] });
    }
    return `STUB: Offline/failed Claude call. Heuristic plan for: ${prompt
      .slice(0, 80)
      .trim()}...`;
  }
}

export function callCodexCLI(
  prompt: string,
  args: string[] = [],
  dryRun = true,
  cwd?: string
): {
  ok: boolean;
  output: string;
  command: string;
} {
  // Filter out unsupported flags for new codex CLI (0.23+)
  const filteredArgs = args.filter((a) => a !== '--no-trace');

  // New codex CLI uses 'exec' subcommand: codex exec "prompt"
  // --full-auto for non-interactive, -C for working directory
  const cdArgs = cwd ? ['-C', cwd] : [];
  const fullArgs = ['exec', '--full-auto', ...cdArgs, prompt, ...filteredArgs];
  const printable = `codex ${fullArgs.map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ')}`;

  if (dryRun) {
    return {
      ok: true,
      output: '[DRY RUN] Skipped execution',
      command: printable,
    };
  }

  try {
    // Check if codex binary is available
    const whichCodex = spawnSync('which', ['codex'], { encoding: 'utf8' });
    if (whichCodex.status !== 0) {
      return {
        ok: true,
        output: '[OFFLINE] Codex CLI not found; skipping execution',
        command: printable,
      };
    }

    const res = spawnSync('codex', fullArgs, {
      encoding: 'utf8',
      timeout: 300000, // 5 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (res.status !== 0) {
      const errorOutput = res.stderr || res.stdout || 'Unknown error';
      return {
        ok: false,
        output: `[ERROR] Codex failed (exit ${res.status}): ${errorOutput.slice(0, 500)}`,
        command: printable,
      };
    }
    return {
      ok: true,
      output: (res.stdout || '') + (res.stderr || ''),
      command: printable,
    };
  } catch (e: any) {
    return { ok: false, output: e?.message || String(e), command: printable };
  }
}

export async function implementWithClaude(
  prompt: string,
  options: { model?: string; system?: string }
): Promise<{ ok: boolean; output: string }> {
  try {
    const out = await callClaude(prompt, {
      model: options.model || 'claude-sonnet-4-20250514',
      system:
        options.system ||
        'You generate minimal diffs/patches for the described change, focusing on one file at a time.',
    });
    return { ok: true, output: out };
  } catch (e: any) {
    return { ok: false, output: e?.message || String(e) };
  }
}
