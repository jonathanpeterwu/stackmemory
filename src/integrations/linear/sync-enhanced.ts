/**
 * Enhanced Linear Sync with Duplicate Detection
 * Prevents duplicate issues by checking titles before creation
 */

import { LinearClient, LinearIssue } from './client.js';
import { logger } from '../../core/monitoring/logger.js';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingIssue?: LinearIssue;
  similarity?: number;
}

export class LinearDuplicateDetector {
  private linearClient: LinearClient;
  private titleCache: Map<string, LinearIssue[]> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastCacheRefresh: number = 0;

  constructor(linearClient: LinearClient) {
    this.linearClient = linearClient;
  }

  /**
   * Search for existing Linear issues with similar titles
   */
  async searchByTitle(title: string, teamId?: string): Promise<LinearIssue[]> {
    const normalizedTitle = this.normalizeTitle(title);
    
    // Check cache first
    if (this.isCacheValid()) {
      const cached = this.titleCache.get(normalizedTitle);
      if (cached) return cached;
    }

    try {
      // Get all issues from the team (Linear API limit is 250)
      const allIssues = await this.linearClient.getIssues({
        teamId,
        limit: 100, // Use smaller limit to avoid API errors
      });

      // Filter for matching titles (exact and fuzzy)
      const matchingIssues = allIssues.filter(issue => {
        const issueNormalized = this.normalizeTitle(issue.title);
        
        // Exact match
        if (issueNormalized === normalizedTitle) return true;
        
        // Fuzzy match - check if titles are very similar
        const similarity = this.calculateSimilarity(normalizedTitle, issueNormalized);
        return similarity > 0.85; // 85% similarity threshold
      });

      // Update cache
      this.titleCache.set(normalizedTitle, matchingIssues);
      this.lastCacheRefresh = Date.now();

      return matchingIssues;
    } catch (error) {
      logger.error('Failed to search Linear issues by title:', error as Error);
      return [];
    }
  }

  /**
   * Check if a task title would create a duplicate in Linear
   */
  async checkForDuplicate(
    title: string,
    teamId?: string
  ): Promise<DuplicateCheckResult> {
    const existingIssues = await this.searchByTitle(title, teamId);
    
    if (existingIssues.length === 0) {
      return { isDuplicate: false };
    }

    // Find the best match
    let bestMatch: LinearIssue | undefined;
    let bestSimilarity = 0;

    for (const issue of existingIssues) {
      const similarity = this.calculateSimilarity(
        this.normalizeTitle(title),
        this.normalizeTitle(issue.title)
      );
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = issue;
      }
    }

    return {
      isDuplicate: true,
      existingIssue: bestMatch,
      similarity: bestSimilarity,
    };
  }

  /**
   * Merge task content into existing Linear issue
   */
  async mergeIntoExisting(
    existingIssue: LinearIssue,
    newTitle: string,
    newDescription?: string,
    additionalContext?: string
  ): Promise<LinearIssue> {
    try {
      // Build merged description
      let mergedDescription = existingIssue.description || '';
      
      if (newDescription && !mergedDescription.includes(newDescription)) {
        mergedDescription += `\n\n## Additional Context (${new Date().toISOString()})\n`;
        mergedDescription += newDescription;
      }

      if (additionalContext) {
        mergedDescription += `\n\n---\n${additionalContext}`;
      }

      // Update the existing issue
      const updateQuery = `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            issue {
              id
              identifier
              title
              description
              updatedAt
            }
          }
        }
      `;

      const variables = {
        id: existingIssue.id,
        input: {
          description: mergedDescription,
        },
      };

      const response = await this.linearClient.graphql(updateQuery, variables);
      const updatedIssue = response.issueUpdate?.issue;

      if (updatedIssue) {
        logger.info(
          `Merged content into existing Linear issue ${existingIssue.identifier}: ${existingIssue.title}`
        );
        return updatedIssue;
      }

      return existingIssue;
    } catch (error) {
      logger.error('Failed to merge into existing Linear issue:', error as Error);
      return existingIssue;
    }
  }

  /**
   * Normalize title for comparison
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
      .replace(/^(sta|eng|bug|feat|task|tsk)[-\s]\d+[-\s:]*/, '') // Remove issue prefixes
      .trim();
  }

  /**
   * Calculate similarity between two strings (Levenshtein distance based)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    // Use Levenshtein distance for similarity calculation
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],    // deletion
            dp[i][j - 1],    // insertion
            dp[i - 1][j - 1] // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    return Date.now() - this.lastCacheRefresh < this.cacheExpiry;
  }

  /**
   * Clear the title cache
   */
  clearCache(): void {
    this.titleCache.clear();
    this.lastCacheRefresh = 0;
  }
}

/**
 * Enhanced sync function that prevents duplicates
 */
export async function syncToLinearWithDuplicateCheck(
  linearClient: LinearClient,
  task: any,
  teamId: string
): Promise<{ issue: LinearIssue; wasmerged: boolean }> {
  const detector = new LinearDuplicateDetector(linearClient);
  
  // Check for duplicates
  const duplicateCheck = await detector.checkForDuplicate(task.title, teamId);
  
  if (duplicateCheck.isDuplicate && duplicateCheck.existingIssue) {
    // Merge into existing issue
    logger.info(
      `Found existing Linear issue for "${task.title}": ${duplicateCheck.existingIssue.identifier} (${Math.round((duplicateCheck.similarity || 0) * 100)}% match)`
    );
    
    const mergedIssue = await detector.mergeIntoExisting(
      duplicateCheck.existingIssue,
      task.title,
      task.description,
      `StackMemory Task ID: ${task.id}`
    );
    
    return { issue: mergedIssue, wasmerged: true };
  }
  
  // No duplicate found, create new issue
  const newIssue = await linearClient.createIssue({
    title: task.title,
    description: task.description,
    teamId,
  });
  
  logger.info(`Created new Linear issue: ${newIssue.identifier}`);
  return { issue: newIssue, wasmerged: false };
}