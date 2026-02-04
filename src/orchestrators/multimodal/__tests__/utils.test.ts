import { describe, it, expect } from 'vitest';
import { compactPlan, deriveProjectId } from '../../multimodal/utils.js';

describe('multimodal utils', () => {
  it('deriveProjectId slugs repo folder name', () => {
    expect(deriveProjectId('/Users/me/Dev/my-Repo_123')).toMatch(
      /my-repo-123$/
    );
    expect(deriveProjectId('/tmp/project')).toBe('project');
  });

  it('compactPlan keeps summary/risks and flattens steps', () => {
    const plan = {
      summary: 'Do X',
      steps: [
        { id: 's1', title: 'One', acceptanceCriteria: ['a', 'b'], extra: true },
        { id: 's2', title: 'Two', acceptanceCriteria: [], extra: false },
      ],
      risks: ['R1'],
    };
    const out = compactPlan(plan);
    expect(out.summary).toBe('Do X');
    expect(out.risks).toEqual(['R1']);
    expect(out.steps).toEqual([
      { id: 's1', title: 'One', acceptanceCriteria: ['a', 'b'] },
      { id: 's2', title: 'Two', acceptanceCriteria: [] },
    ]);
  });
});
