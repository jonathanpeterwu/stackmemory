/**
 * Spec Generator Skill
 * Generates iterative spec documents: ONE_PAGER → DEV_SPEC → PROMPT_PLAN → AGENTS.md
 * Progressive context — later docs read earlier ones from disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillContext, SkillResult } from './claude-skills.js';
import { logger } from '../core/monitoring/logger.js';

export type SpecType = 'one-pager' | 'dev-spec' | 'prompt-plan' | 'agents';

interface SpecConfig {
  filename: string;
  title: string;
  sections: string[];
  inputs: SpecType[]; // earlier docs this type reads
}

const SPEC_DIR = 'docs/specs';

const SPEC_CONFIGS: Record<SpecType, SpecConfig> = {
  'one-pager': {
    filename: 'ONE_PAGER.md',
    title: 'One-Pager',
    sections: [
      'Problem',
      'Audience',
      'Platform',
      'Core Flow',
      'MVP Features',
      'Non-Goals',
      'Metrics',
    ],
    inputs: [],
  },
  'dev-spec': {
    filename: 'DEV_SPEC.md',
    title: 'Development Specification',
    sections: [
      'Architecture',
      'Tech Stack',
      'API Contracts',
      'Data Models',
      'Auth',
      'Error Handling',
      'Deployment',
    ],
    inputs: ['one-pager'],
  },
  'prompt-plan': {
    filename: 'PROMPT_PLAN.md',
    title: 'Prompt Plan',
    sections: [
      'Stage A: Project Setup',
      'Stage B: Core Data Models',
      'Stage C: API Layer',
      'Stage D: Business Logic',
      'Stage E: Frontend / UI',
      'Stage F: Integration & Testing',
      'Stage G: Deploy & Polish',
    ],
    inputs: ['one-pager', 'dev-spec'],
  },
  agents: {
    filename: 'AGENTS.md',
    title: 'AGENTS.md',
    sections: [
      'Repo Files',
      'Responsibilities',
      'Guardrails',
      'Testing',
      'When to Ask',
    ],
    inputs: ['one-pager', 'dev-spec', 'prompt-plan'],
  },
};

// --- Templates ---

function onePagerTemplate(title: string): string {
  return `# ${title} — One-Pager

## Problem
<!-- What problem does this solve? Who has this problem? -->

## Audience
<!-- Primary users and their context -->

## Platform
<!-- Web / Mobile / CLI / API — and why -->

## Core Flow
<!-- Happy-path user journey in 3-5 steps -->
1.
2.
3.

## MVP Features
<!-- Minimum set of features for first release -->
- [ ]
- [ ]
- [ ]

## Non-Goals
<!-- Explicitly out of scope for MVP -->
-

## Metrics
<!-- How will you measure success? -->
-
`;
}

function devSpecTemplate(title: string, onePagerContent: string): string {
  return `# ${title} — Development Specification

> Generated from ONE_PAGER.md

<details><summary>Source: ONE_PAGER.md</summary>

${onePagerContent}

</details>

## Architecture
<!-- High-level system diagram / component breakdown -->

## Tech Stack
<!-- Languages, frameworks, databases, infra -->
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | | |
| Backend | | |
| Database | | |
| Hosting | | |

## API Contracts
<!-- Key endpoints with request/response shapes -->

## Data Models
<!-- Core entities and relationships -->

## Auth
<!-- Authentication and authorization strategy -->

## Error Handling
<!-- Error codes, retry strategies, user-facing messages -->

## Deployment
<!-- CI/CD, environments, rollback strategy -->
`;
}

function promptPlanTemplate(
  title: string,
  onePagerContent: string,
  devSpecContent: string
): string {
  return `# ${title} — Prompt Plan

> Generated from ONE_PAGER.md and DEV_SPEC.md
> Each stage has TDD checkboxes — check off as tasks complete.

<details><summary>Source: ONE_PAGER.md</summary>

${onePagerContent}

</details>

<details><summary>Source: DEV_SPEC.md</summary>

${devSpecContent}

</details>

## Stage A: Project Setup
- [ ] Initialize repository and tooling
- [ ] Configure CI/CD pipeline
- [ ] Set up development environment

## Stage B: Core Data Models
- [ ] Define database schema
- [ ] Create model layer
- [ ] Write model tests

## Stage C: API Layer
- [ ] Implement API endpoints
- [ ] Add input validation
- [ ] Write API tests

## Stage D: Business Logic
- [ ] Implement core business rules
- [ ] Add edge case handling
- [ ] Write integration tests

## Stage E: Frontend / UI
- [ ] Build core UI components
- [ ] Implement user flows
- [ ] Write UI tests

## Stage F: Integration & Testing
- [ ] End-to-end test suite
- [ ] Performance testing
- [ ] Security audit

## Stage G: Deploy & Polish
- [ ] Production deployment
- [ ] Monitoring and alerting
- [ ] Documentation
`;
}

function agentsTemplate(title: string, inputs: Record<string, string>): string {
  const sourceBlocks = Object.entries(inputs)
    .map(
      ([name, content]) =>
        `<details><summary>Source: ${name}</summary>\n\n${content}\n\n</details>`
    )
    .join('\n\n');

  return `# ${title} — AGENTS.md

> Auto-generated agent configuration for Claude Code / Cursor / Windsurf.

${sourceBlocks}

## Repo Files
<!-- Key files and their purpose -->
| File | Purpose |
|------|---------|
| | |

## Responsibilities
<!-- What this agent should and shouldn't do -->
### DO
-

### DON'T
-

## Guardrails
<!-- Safety constraints and limits -->
- Never commit secrets or credentials
- Always run tests before committing
- Keep changes focused and atomic

## Testing
<!-- How to validate changes -->
\`\`\`bash
npm test
npm run lint
npm run build
\`\`\`

## When to Ask
<!-- Situations where the agent should ask for human input -->
- Architectural changes affecting multiple systems
- Security-sensitive modifications
- Breaking API changes
- Ambiguous requirements
`;
}

// --- Skill Class ---

export class SpecGeneratorSkill {
  private baseDir: string;

  constructor(private context: SkillContext) {
    this.baseDir = process.cwd();
  }

  /** Generate a spec document by type */
  async generate(
    type: SpecType,
    title: string,
    opts?: { force?: boolean }
  ): Promise<SkillResult> {
    const config = SPEC_CONFIGS[type];
    if (!config) {
      return { success: false, message: `Unknown spec type: ${type}` };
    }

    const specDir = path.join(this.baseDir, SPEC_DIR);
    const outputPath = path.join(specDir, config.filename);

    // Check if file already exists
    if (fs.existsSync(outputPath) && !opts?.force) {
      return {
        success: false,
        message: `${config.filename} already exists. Use --force to overwrite.`,
        data: { path: outputPath },
      };
    }

    // Load input documents (progressive context)
    const inputContents: Record<string, string> = {};
    for (const inputType of config.inputs) {
      const inputConfig = SPEC_CONFIGS[inputType];
      const inputPath = path.join(specDir, inputConfig.filename);
      if (fs.existsSync(inputPath)) {
        inputContents[inputConfig.filename] = fs.readFileSync(
          inputPath,
          'utf-8'
        );
      }
    }

    // Generate content from template
    const content = this.renderTemplate(type, title, inputContents);

    // Write file
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf-8');

    logger.info(`Generated spec: ${config.filename}`, { type, title });

    return {
      success: true,
      message: `Created ${config.filename}`,
      data: {
        path: outputPath,
        type,
        sections: config.sections,
        inputsUsed: Object.keys(inputContents),
      },
      action: `Generated ${SPEC_DIR}/${config.filename}`,
    };
  }

  /** List existing spec documents */
  async list(): Promise<SkillResult> {
    const specDir = path.join(this.baseDir, SPEC_DIR);
    const specs: Array<{
      type: SpecType;
      filename: string;
      exists: boolean;
      path: string;
    }> = [];

    for (const [type, config] of Object.entries(SPEC_CONFIGS)) {
      const filePath = path.join(specDir, config.filename);
      specs.push({
        type: type as SpecType,
        filename: config.filename,
        exists: fs.existsSync(filePath),
        path: filePath,
      });
    }

    const existing = specs.filter((s) => s.exists);
    const missing = specs.filter((s) => !s.exists);

    return {
      success: true,
      message: `${existing.length}/${specs.length} specs exist`,
      data: { specs, existing, missing },
    };
  }

  /** Update a spec — primarily for checking off PROMPT_PLAN items */
  async update(filePath: string, changes: string): Promise<SkillResult> {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.baseDir, filePath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, message: `File not found: ${resolvedPath}` };
    }

    let content = fs.readFileSync(resolvedPath, 'utf-8');

    // Parse checkbox updates: "Stage A:1" means check item 1 in Stage A
    const checkboxPattern = /^(Stage [A-G])(?::(\d+))?$/;
    const match = changes.match(checkboxPattern);

    if (match) {
      const [, stageName, itemNum] = match;
      content = this.checkItem(
        content,
        stageName,
        itemNum ? parseInt(itemNum) : undefined
      );
    } else {
      // Treat as direct checkbox text match: find "- [ ] <changes>" and check it
      const escaped = changes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`- \\[ \\] ${escaped}`, 'i');
      if (re.test(content)) {
        content = content.replace(re, `- [x] ${changes}`);
      } else {
        return {
          success: false,
          message: `No unchecked item matching "${changes}" found`,
        };
      }
    }

    // Append changelog entry
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const changelog = `\n<!-- Updated: ${timestamp} | ${changes} -->\n`;
    content += changelog;

    fs.writeFileSync(resolvedPath, content, 'utf-8');

    logger.info('Updated spec', { path: resolvedPath, changes });

    return {
      success: true,
      message: `Updated: ${changes}`,
      data: { path: resolvedPath, changes },
      action: `Checked off item in ${path.basename(resolvedPath)}`,
    };
  }

  /** Validate completeness of a spec */
  async validate(filePath: string): Promise<SkillResult> {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.baseDir, filePath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, message: `File not found: ${resolvedPath}` };
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');

    // Count checkboxes
    const unchecked = (content.match(/- \[ \]/g) || []).length;
    const checked = (content.match(/- \[x\]/gi) || []).length;
    const total = checked + unchecked;

    // Check for empty sections (## header followed by only whitespace/comments)
    const emptySections: string[] = [];
    const sectionRegex = /^## (.+)$/gm;
    let sectionMatch;

    while ((sectionMatch = sectionRegex.exec(content)) !== null) {
      const sectionName = sectionMatch[1];
      const sectionStart = content.indexOf(sectionMatch[0]);
      const nextSection = content.indexOf('\n## ', sectionStart + 1);
      const sectionContent =
        nextSection === -1
          ? content.slice(sectionStart + sectionMatch[0].length)
          : content.slice(sectionStart + sectionMatch[0].length, nextSection);

      // Strip comments and whitespace
      const stripped = sectionContent
        .replace(/<!--.*?-->/gs, '')
        .replace(/\s+/g, '')
        .trim();

      if (stripped.length === 0 || stripped === '||') {
        emptySections.push(sectionName);
      }
    }

    const isComplete = unchecked === 0 && emptySections.length === 0;

    return {
      success: true,
      message: isComplete
        ? 'Spec is complete'
        : `Spec incomplete: ${unchecked} unchecked items, ${emptySections.length} empty sections`,
      data: {
        path: resolvedPath,
        checkboxes: { checked, unchecked, total },
        emptySections,
        isComplete,
        completionPercent:
          total > 0 ? Math.round((checked / total) * 100) : 100,
      },
    };
  }

  // --- Private helpers ---

  private renderTemplate(
    type: SpecType,
    title: string,
    inputs: Record<string, string>
  ): string {
    switch (type) {
      case 'one-pager':
        return onePagerTemplate(title);

      case 'dev-spec':
        return devSpecTemplate(
          title,
          inputs['ONE_PAGER.md'] ||
            '*ONE_PAGER.md not found — generate it first.*'
        );

      case 'prompt-plan':
        return promptPlanTemplate(
          title,
          inputs['ONE_PAGER.md'] || '*ONE_PAGER.md not found*',
          inputs['DEV_SPEC.md'] ||
            '*DEV_SPEC.md not found — generate it first.*'
        );

      case 'agents':
        return agentsTemplate(title, inputs);

      default:
        return `# ${title}\n\nUnknown spec type: ${type}\n`;
    }
  }

  /** Check off a specific checkbox item in a stage */
  private checkItem(
    content: string,
    stageName: string,
    itemIndex?: number
  ): string {
    const lines = content.split('\n');
    let inStage = false;
    let itemCount = 0;

    for (let i = 0; i < lines.length; i++) {
      // Detect stage header
      if (lines[i].startsWith('## ') && lines[i].includes(stageName)) {
        inStage = true;
        itemCount = 0;
        continue;
      }

      // Exit stage on next header
      if (inStage && lines[i].startsWith('## ')) {
        break;
      }

      // Process checkbox
      if (inStage && lines[i].match(/^- \[ \]/)) {
        itemCount++;
        if (itemIndex === undefined || itemCount === itemIndex) {
          lines[i] = lines[i].replace('- [ ]', '- [x]');
          if (itemIndex !== undefined) break;
        }
      }
    }

    return lines.join('\n');
  }
}
