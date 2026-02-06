/**
 * Linear API Client
 * Handles all Linear API interactions
 */

import {
  type LinearAuth,
  type LinearIssue,
  type LinearIssueCreate,
  type LinearProject,
  type LinearLabel,
  type ExtensionError,
  type Result,
  ok,
  err,
} from './types.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Linear GraphQL client
 */
export class LinearClient {
  private auth: LinearAuth;

  constructor(auth: LinearAuth) {
    this.auth = auth;
  }

  /**
   * Execute a GraphQL query/mutation
   */
  private async query<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<Result<T, ExtensionError>> {
    try {
      const response = await fetch(LINEAR_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.auth.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        return err({
          code: 'LINEAR_API_ERROR',
          message: `Linear API error: ${response.status}`,
          details: { status: response.status },
        });
      }

      const json = (await response.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        return err({
          code: 'LINEAR_API_ERROR',
          message: json.errors[0].message,
          details: { errors: json.errors },
        });
      }

      return ok(json.data as T);
    } catch (error) {
      return err({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
      });
    }
  }

  /**
   * Create a new issue
   */
  async createIssue(
    issue: LinearIssueCreate
  ): Promise<Result<LinearIssue, ExtensionError>> {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state {
              id
              name
            }
          }
        }
      }
    `;

    const result = await this.query<{
      issueCreate: {
        success: boolean;
        issue: LinearIssue;
      };
    }>(mutation, {
      input: {
        title: issue.title,
        description: issue.description,
        teamId: issue.teamId,
        projectId: issue.projectId,
        priority: issue.priority,
        labelIds: issue.labelIds,
      },
    });

    if (!result.ok) {
      return result;
    }

    if (!result.value.issueCreate.success) {
      return err({
        code: 'LINEAR_API_ERROR',
        message: 'Failed to create issue',
      });
    }

    return ok(result.value.issueCreate.issue);
  }

  /**
   * Add a comment to an issue
   */
  async addComment(
    issueId: string,
    body: string
  ): Promise<Result<string, ExtensionError>> {
    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
          }
        }
      }
    `;

    const result = await this.query<{
      commentCreate: {
        success: boolean;
        comment: { id: string };
      };
    }>(mutation, {
      input: {
        issueId,
        body,
      },
    });

    if (!result.ok) {
      return result;
    }

    if (!result.value.commentCreate.success) {
      return err({
        code: 'LINEAR_API_ERROR',
        message: 'Failed to create comment',
      });
    }

    return ok(result.value.commentCreate.comment.id);
  }

  /**
   * Update issue state (e.g., close it)
   */
  async updateIssueState(
    issueId: string,
    stateId: string
  ): Promise<Result<void, ExtensionError>> {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
    `;

    const result = await this.query<{
      issueUpdate: { success: boolean };
    }>(mutation, {
      id: issueId,
      input: { stateId },
    });

    if (!result.ok) {
      return result;
    }

    if (!result.value.issueUpdate.success) {
      return err({
        code: 'LINEAR_API_ERROR',
        message: 'Failed to update issue',
      });
    }

    return ok(undefined);
  }

  /**
   * Get projects for the team
   */
  async getProjects(): Promise<Result<LinearProject[], ExtensionError>> {
    const query = `
      query GetProjects($teamId: String!) {
        team(id: $teamId) {
          projects {
            nodes {
              id
              name
              state
            }
          }
        }
      }
    `;

    const result = await this.query<{
      team: {
        projects: {
          nodes: LinearProject[];
        };
      };
    }>(query, { teamId: this.auth.teamId });

    if (!result.ok) {
      return result;
    }

    // Filter to active projects
    const projects = result.value.team.projects.nodes.filter(
      (p) => p.state !== 'canceled' && p.state !== 'completed'
    );

    return ok(projects);
  }

  /**
   * Get labels for the team
   */
  async getLabels(): Promise<Result<LinearLabel[], ExtensionError>> {
    const query = `
      query GetLabels($teamId: String!) {
        team(id: $teamId) {
          labels {
            nodes {
              id
              name
              color
            }
          }
        }
      }
    `;

    const result = await this.query<{
      team: {
        labels: {
          nodes: LinearLabel[];
        };
      };
    }>(query, { teamId: this.auth.teamId });

    if (!result.ok) {
      return result;
    }

    return ok(result.value.team.labels.nodes);
  }

  /**
   * Get "Done" state ID for closing issues
   */
  async getDoneStateId(): Promise<Result<string, ExtensionError>> {
    const query = `
      query GetStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes {
              id
              name
              type
            }
          }
        }
      }
    `;

    const result = await this.query<{
      team: {
        states: {
          nodes: Array<{ id: string; name: string; type: string }>;
        };
      };
    }>(query, { teamId: this.auth.teamId });

    if (!result.ok) {
      return result;
    }

    const doneState = result.value.team.states.nodes.find(
      (s) => s.type === 'completed'
    );

    if (!doneState) {
      return err({
        code: 'LINEAR_API_ERROR',
        message: 'No completed state found for team',
      });
    }

    return ok(doneState.id);
  }
}
