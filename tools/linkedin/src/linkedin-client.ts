import { z } from "zod";
import { requireDispatchContext } from "@mammoth/shared/security";

const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";
const REQUEST_TIMEOUT_MS = 15_000;

const LinkedInPostResponseSchema = z.object({
  id: z.string(),
});

export type LinkedInPostOptions = {
  /** LinkedIn member URN: urn:li:person:{id} */
  authorUrn: string;
  text: string;
  /** Optional: share a URL along with the post */
  shareUrl?: string;
  shareTitle?: string;
  shareDescription?: string;
};

export type LinkedInPostResult =
  | { posted: true; postUrn: string; postUrl: string }
  | { posted: false; reason: string };

/**
 * Posts a text update to LinkedIn using the UGC Posts API.
 * Requires an access token with `w_member_social` scope.
 *
 * @param accessToken - LinkedIn OAuth2 access token
 * @param options - Post content and author configuration
 */
export async function postToLinkedIn(
  accessToken: string,
  options: LinkedInPostOptions
): Promise<LinkedInPostResult> {
  requireDispatchContext();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      author: options.authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: options.text },
          shareMediaCategory: options.shareUrl ? "ARTICLE" : "NONE",
          ...(options.shareUrl
            ? {
                media: [
                  {
                    status: "READY",
                    originalUrl: options.shareUrl,
                    title: { text: options.shareTitle ?? "" },
                    description: { text: options.shareDescription ?? "" },
                  },
                ],
              }
            : {}),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const response = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { posted: false, reason: `LinkedIn API ${response.status}: ${errorText}` };
    }

    const raw = await response.json();
    const parsed = LinkedInPostResponseSchema.parse(raw);

    // LinkedIn post URN → URL: urn:li:ugcPost:12345 → linkedin.com/feed/update/urn:li:ugcPost:12345
    const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(parsed.id)}`;

    return { posted: true, postUrn: parsed.id, postUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown LinkedIn error";
    return { posted: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Gets the authenticated LinkedIn member's profile ID.
 * Required to construct the author URN for posting.
 * Returns null if the token is invalid or the request fails.
 *
 * @param accessToken - LinkedIn OAuth2 access token
 */
export async function getLinkedInMemberId(accessToken: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${LINKEDIN_API_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json() as { sub?: string };
    return data.sub ? `urn:li:person:${data.sub}` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
