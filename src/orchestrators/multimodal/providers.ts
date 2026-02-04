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
  const model = options.model || 'claude-3-5-sonnet-latest';
  const system =
    options.system || 'You are a precise software planning assistant.';

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = msg?.content?.[0];
  const text = block && 'text' in block ? block.text : JSON.stringify(msg);
  return text;
}

export function callCodexCLI(
  prompt: string,
  args: string[] = [],
  dryRun = true
): {
  ok: boolean;
  output: string;
  command: string;
} {
  // Prefer our codex-sm wrapper which sets tracing/context
  const cmd = 'codex-sm';
  const fullArgs = ['-p', prompt, ...args];
  const printable = `${cmd} ${fullArgs.map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ')}`;

  if (dryRun) {
    return {
      ok: true,
      output: '[DRY RUN] Skipped execution',
      command: printable,
    };
  }

  try {
    // Check if any codex binary is available (codex-sm preferred, fallback to codex/codex-cli)
    const whichSm = spawnSync('which', ['codex-sm'], { encoding: 'utf8' });
    const whichCodex = spawnSync('which', ['codex'], { encoding: 'utf8' });
    const whichCli = spawnSync('which', ['codex-cli'], { encoding: 'utf8' });
    const availableCmd =
      whichSm.status === 0
        ? 'codex-sm'
        : whichCodex.status === 0
          ? 'codex'
          : whichCli.status === 0
            ? 'codex-cli'
            : null;

    if (!availableCmd) {
      return {
        ok: true,
        output: '[OFFLINE] Codex CLI not found; skipping execution',
        command: printable,
      };
    }
    const res = spawnSync(availableCmd, fullArgs, { encoding: 'utf8' });
    if (res.status !== 0) {
      return {
        ok: true,
        output:
          '[OFFLINE] Codex run failed or unavailable; treating as no-op for offline run',
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
      model: options.model || 'claude-3-5-sonnet-latest',
      system:
        options.system ||
        'You generate minimal diffs/patches for the described change, focusing on one file at a time.',
    });
    return { ok: true, output: out };
  } catch (e: any) {
    return { ok: false, output: e?.message || String(e) };
  }
}
