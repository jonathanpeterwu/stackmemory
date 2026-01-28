/**
 * Feature Flags Configuration
 * Controls which external integrations are enabled
 *
 * Set STACKMEMORY_LOCAL=true to run without any external services
 */

export interface FeatureFlags {
  // Core features (always available)
  core: true;

  // External integrations (can be disabled)
  linear: boolean;
  whatsapp: boolean;
  chromadb: boolean;
  aiSummaries: boolean;
  skills: boolean;
}

/**
 * Check if running in local-only mode
 * When true, all external service integrations are disabled
 */
export function isLocalOnly(): boolean {
  return (
    process.env['STACKMEMORY_LOCAL'] === 'true' ||
    process.env['STACKMEMORY_LOCAL'] === '1' ||
    process.env['LOCAL_ONLY'] === 'true'
  );
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  if (feature === 'core') return true;

  // In local-only mode, external integrations are disabled
  if (isLocalOnly()) return false;

  // Check feature-specific env vars
  switch (feature) {
    case 'linear':
      return (
        process.env['STACKMEMORY_LINEAR'] !== 'false' &&
        (!!process.env['LINEAR_API_KEY'] || !!process.env['LINEAR_OAUTH_TOKEN'])
      );
    case 'whatsapp':
      return (
        process.env['STACKMEMORY_WHATSAPP'] !== 'false' &&
        !!process.env['TWILIO_ACCOUNT_SID']
      );
    case 'chromadb':
      return process.env['STACKMEMORY_CHROMADB'] === 'true';
    case 'aiSummaries':
      return (
        process.env['STACKMEMORY_AI'] !== 'false' &&
        (!!process.env['ANTHROPIC_API_KEY'] || !!process.env['OPENAI_API_KEY'])
      );
    case 'skills':
      // Skills enabled explicitly or when AI summaries available
      return (
        process.env['STACKMEMORY_SKILLS'] === 'true' ||
        process.env['STACKMEMORY_SKILLS'] === '1'
      );
    default:
      return false;
  }
}

/**
 * Get all feature flags
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    core: true,
    linear: isFeatureEnabled('linear'),
    whatsapp: isFeatureEnabled('whatsapp'),
    chromadb: isFeatureEnabled('chromadb'),
    aiSummaries: isFeatureEnabled('aiSummaries'),
    skills: isFeatureEnabled('skills'),
  };
}

/**
 * Log feature flags status (for debugging)
 */
export function logFeatureStatus(): void {
  const flags = getFeatureFlags();
  const local = isLocalOnly();

  console.log(
    `StackMemory Mode: ${local ? 'LOCAL (no external services)' : 'FULL'}`
  );
  if (!local) {
    console.log(
      `  Linear: ${flags.linear ? 'enabled' : 'disabled (no API key)'}`
    );
    console.log(
      `  WhatsApp: ${flags.whatsapp ? 'enabled' : 'disabled (no Twilio)'}`
    );
    console.log(`  ChromaDB: ${flags.chromadb ? 'enabled' : 'disabled'}`);
    console.log(
      `  AI Summaries: ${flags.aiSummaries ? 'enabled' : 'disabled (no API key)'}`
    );
    console.log(
      `  Skills: ${flags.skills ? 'enabled' : 'disabled (set STACKMEMORY_SKILLS=true)'}`
    );
  }
}
