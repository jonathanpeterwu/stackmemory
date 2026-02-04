import { spawnSync } from 'child_process';

// Lightweight provider wrappers with safe fallbacks for a spike.

export async function callClaude(
  prompt: string,
  options: { model?: string; system?: string }
): Promise<string> {
  // Use Anthropic SDK only if key is present; otherwise return a stubbed plan
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return `STUB: No ANTHROPIC_API_KEY set. Returning heuristic plan for prompt: ${prompt.slice(0, 80)}...`;
  }

  // Dynamic import to avoid bundling the SDK when not needed
  const { Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const model = options.model || 'claude-3-5-sonnet-latest';
  const system =
    options.system || 'You are a precise software planning assistant.';

  const msg = await client.messages.create({
    model,
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (msg?.content?.[0] as any)?.text || JSON.stringify(msg);
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
    const res = spawnSync(cmd, fullArgs, { encoding: 'utf8' });
    return {
      ok: res.status === 0,
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
