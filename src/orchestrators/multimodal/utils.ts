export function deriveProjectId(repoPath: string): string {
  const id = repoPath.replace(/\/+$/, '').split('/').pop() || 'project';
  return (
    id
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(-50) || 'project'
  );
}

export function compactPlan(plan: any) {
  try {
    const steps = Array.isArray(plan?.steps)
      ? plan.steps.map((s: any) => ({
          id: s.id,
          title: s.title,
          acceptanceCriteria: s.acceptanceCriteria,
        }))
      : [];
    return { summary: plan?.summary, steps, risks: plan?.risks };
  } catch {
    return plan;
  }
}
