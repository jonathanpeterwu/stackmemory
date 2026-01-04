/**
 * Stub workflow templates for testing
 */

export const workflowTemplates = {
  tdd: {
    name: 'Test-Driven Development',
    description: 'Write tests first, then implement',
    phases: [
      { name: 'write-failing-tests', description: 'Write tests that fail' },
      { name: 'implement-code', description: 'Make tests pass' },
      { name: 'refactor', description: 'Clean up code' }
    ]
  },
  feature: {
    name: 'Feature Development',
    description: 'Develop a new feature',
    phases: [
      { name: 'design', description: 'Design the feature' },
      { name: 'implement', description: 'Build the feature' },
      { name: 'test', description: 'Test the feature' }
    ]
  },
  bugfix: {
    name: 'Bug Fix',
    description: 'Fix a reported bug',
    phases: [
      { name: 'reproduce', description: 'Reproduce the bug' },
      { name: 'fix', description: 'Fix the bug' },
      { name: 'verify', description: 'Verify the fix' }
    ]
  },
  refactor: {
    name: 'Refactoring',
    description: 'Improve code structure',
    phases: [
      { name: 'analyze', description: 'Analyze current code' },
      { name: 'refactor', description: 'Refactor code' },
      { name: 'test', description: 'Ensure no regressions' }
    ]
  }
};