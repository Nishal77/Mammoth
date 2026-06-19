import { z } from "zod";
import { requireDispatchContext } from "@mammoth/shared/security";

const TWITTER_API_BASE = "https://api.twitter.com/2";
const REQUEST_TIMEOUT_MS = 15_000;

const TweetResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    text: z.string(),
  }),
});

export type TweetOptions = {
  text: string;
  /** Optional: reply to this tweet ID */
  replyToTweetId?: string;
};

export type TweetResult =
  | { posted: true; tweetId: string; tweetUrl: string }
  | { posted: false; reason: string };

/**
 * Posts a tweet using the Twitter v2 API.
 * Requires an OAuth2 bearer token with `tweet.write` scope.
 *
 * @param bearerToken - Twitter OAuth 2.0 user access token
 * @param options - Tweet content and optional reply configuration
 */
export async function postTweet(
  bearerToken: string,
  options: TweetOptions
): Promise<TweetResult> {
  requireDispatchContext();
  if (options.text.length > 280) {
    return { posted: false, reason: "Tweet exceeds 280 character limit" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = { text: options.text };

    if (options.replyToTweetId) {
      body["reply"] = { in_reply_to_tweet_id: options.replyToTweetId };
    }

    const response = await fetch(`${TWITTER_API_BASE}/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { posted: false, reason: `Twitter API ${response.status}: ${errorText}` };
    }

    const raw = await response.json();
    const parsed = TweetResponseSchema.parse(raw);

    const tweetUrl = `https://twitter.com/i/web/status/${parsed.data.id}`;

    return { posted: true, tweetId: parsed.data.id, tweetUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Twitter error";
    return { posted: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verifies that a Twitter bearer token is valid.
 * Returns the authenticated username or null on failure.
 *
 * @param bearerToken - Twitter OAuth 2.0 bearer token
 */
export async function verifyTwitterToken(bearerToken: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${TWITTER_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json() as { data?: { username?: string } };
    return data.data?.username ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
