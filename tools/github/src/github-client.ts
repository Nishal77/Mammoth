import { Octokit } from "@octokit/rest";

const REQUEST_TIMEOUT_MS = 15_000;

export type GithubPullRequest = {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  /** ISO 8601 date string */
  createdAt: string;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  labels: string[];
};

export type GithubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  labels: string[];
  createdAt: string;
  url: string;
};

export type GithubRepoContext = {
  openPullRequests: GithubPullRequest[];
  openIssues: GithubIssue[];
  /** Total open PRs (may be more than the returned array if paginated) */
  totalOpenPrs: number;
  /** Total open issues */
  totalOpenIssues: number;
};

/**
 * Fetches open pull requests and issues from a GitHub repository.
 * Used by the Engineering agent to understand the current sprint state.
 *
 * @param accessToken - GitHub personal access token or OAuth access token
 * @param owner       - GitHub org or username (e.g. "acmecorp")
 * @param repo        - Repository name (e.g. "api-service")
 * @param limit       - Max items to fetch per type (default 30)
 */
export async function fetchRepoContext(
  accessToken: string,
  owner: string,
  repo: string,
  limit = 30
): Promise<GithubRepoContext> {
  const octokit = new Octokit({
    auth: accessToken,
    request: { timeout: REQUEST_TIMEOUT_MS },
  });

  // Fetch PRs and issues in parallel — independent API calls
  const [prResponse, issueResponse] = await Promise.all([
    octokit.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: Math.min(limit, 100),
      sort: "updated",
      direction: "desc",
    }),
    octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      per_page: Math.min(limit, 100),
      sort: "updated",
      direction: "desc",
    }),
  ]);

  const openPullRequests: GithubPullRequest[] = prResponse.data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state as "open" | "closed",
    author: pr.user?.login ?? "unknown",
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    url: pr.html_url,
    isDraft: pr.draft ?? false,
    labels: pr.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
  }));

  // GitHub issues endpoint also returns pull requests — filter those out
  const openIssues: GithubIssue[] = issueResponse.data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state as "open" | "closed",
      author: issue.user?.login ?? "unknown",
      labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
      createdAt: issue.created_at,
      url: issue.html_url,
    }));

  return {
    openPullRequests,
    openIssues,
    totalOpenPrs: prResponse.data.length,
    totalOpenIssues: openIssues.length,
  };
}

/**
 * Verifies that a GitHub access token is valid by calling the /user endpoint.
 * Returns the authenticated user's login or null if the token is invalid.
 */
export async function verifyGithubToken(accessToken: string): Promise<string | null> {
  try {
    const octokit = new Octokit({
      auth: accessToken,
      request: { timeout: REQUEST_TIMEOUT_MS },
    });

    const { data } = await octokit.users.getAuthenticated();
    return data.login;
  } catch {
    return null;
  }
}
