/**
 * PR/Issue Tracker Component
 * Displays GitHub PRs and issues with status indicators
 */

import blessed from 'blessed';
import { EventEmitter } from 'events';
import type { PRData, IssueData } from '../types.js';

export class PRTracker extends EventEmitter {
  private list: blessed.Widgets.ListElement;
  private prs: Map<string, PRData>;
  private issues: Map<string, IssueData>;
  private selectedItem: string | null = null;
  private viewMode: 'prs' | 'issues' = 'prs';

  constructor(list: blessed.Widgets.ListElement) {
    super();
    this.list = list;
    this.prs = new Map();
    this.issues = new Map();
    this.initializeUI();
  }

  private initializeUI(): void {
    this.list.on('select', (item, index) => {
      if (this.viewMode === 'prs') {
        const prId = Array.from(this.prs.keys())[index];
        this.selectPR(prId);
      } else {
        const issueId = Array.from(this.issues.keys())[index];
        this.selectIssue(issueId);
      }
    });

    // Toggle between PRs and Issues
    this.list.key(['tab'], () => {
      this.toggleView();
    });
  }

  private formatPRItem(pr: PRData): string {
    const status = this.getPRStatusIcon(pr);
    const checks = this.getChecksStatus(pr.checks);
    const reviews = this.getReviewStatus(pr.reviews);

    let item = `${status} #${pr.number}: ${pr.title}\n`;
    item += `   {gray-fg}@${pr.author.login} | ${checks} | ${reviews} | +${pr.additions}/-${pr.deletions}{/}`;

    if (pr.linkedIssues?.length) {
      item += ` | {cyan-fg}🔗${pr.linkedIssues.length}{/}`;
    }

    return item;
  }

  private formatIssueItem(issue: IssueData): string {
    const status = issue.state === 'open' ? '{green-fg}●{/}' : '{gray-fg}●{/}';
    const assignees =
      issue.assignees?.map((a: any) => `@${a}`).join(', ') || 'unassigned';

    let item = `${status} #${issue.number}: ${issue.title}\n`;
    item += `   {gray-fg}@${issue.author.login} | ${assignees} | 💬${issue.comments}{/}`;

    return item;
  }

  private getPRStatusIcon(pr: PRData): string {
    if (pr.state === 'merged') return '{magenta-fg}⬤{/}';
    if (pr.state === 'closed') return '{red-fg}⬤{/}';
    if (pr.draft) return '{gray-fg}○{/}';
    return '{green-fg}●{/}';
  }

  private getChecksStatus(checks?: PRData['checks']): string {
    if (!checks) return '{gray-fg}no checks{/}';
    if (checks.failed > 0)
      return `{red-fg}✗ ${checks.failed}/${checks.total}{/}`;
    if (checks.pending > 0)
      return `{yellow-fg}⏳ ${checks.pending}/${checks.total}{/}`;
    return `{green-fg}✓ ${checks.passed}/${checks.total}{/}`;
  }

  private getReviewStatus(reviews: PRData['reviews']): string {
    const approved = reviews.filter((r: any) => r.state === 'approved').length;
    const changes = reviews.filter(
      (r: any) => r.state === 'changes_requested'
    ).length;

    if (changes > 0) return `{red-fg}👎${changes}{/}`;
    if (approved > 0) return `{green-fg}👍${approved}{/}`;
    return '{gray-fg}no reviews{/}';
  }

  public update(data: { prs?: PRData[]; issues?: IssueData[] }): void {
    if (data.prs) {
      this.prs.clear();
      data.prs.forEach((pr) => this.prs.set(pr.id, pr));
    }

    if (data.issues) {
      this.issues.clear();
      data.issues.forEach((issue) => this.issues.set(issue.id, issue));
    }

    this.refreshDisplay();
  }

  private refreshDisplay(): void {
    let items: string[] = [];
    let label = '';

    if (this.viewMode === 'prs') {
      items = Array.from(this.prs.values()).map((pr: any) =>
        this.formatPRItem(pr)
      );
      const open = Array.from(this.prs.values()).filter(
        (pr: any) => pr.state === 'open'
      ).length;
      label = ` 🔀 Pull Requests (${open}/${this.prs.size}) [Tab] Issues `;
    } else {
      items = Array.from(this.issues.values()).map((issue: any) =>
        this.formatIssueItem(issue)
      );
      const open = Array.from(this.issues.values()).filter(
        (i: any) => i.state === 'open'
      ).length;
      label = ` 🐛 Issues (${open}/${this.issues.size}) [Tab] PRs `;
    }

    this.list.setItems(items);
    if (
      this.list.parent &&
      typeof (this.list.parent as any).setLabel === 'function'
    ) {
      (this.list.parent as any).setLabel(label);
    }

    this.list.screen.render();
  }

  private toggleView(): void {
    this.viewMode = this.viewMode === 'prs' ? 'issues' : 'prs';
    this.refreshDisplay();
  }

  private selectPR(prId: string): void {
    const pr = this.prs.get(prId);
    if (pr) {
      this.emit('pr:selected', pr);
    }
  }

  private selectIssue(issueId: string): void {
    const issue = this.issues.get(issueId);
    if (issue) {
      this.emit('issue:selected', issue);
    }
  }

  public focus(): void {
    this.list.focus();
  }

  public hasFocus(): boolean {
    return this.list === this.list.screen.focused;
  }
}
