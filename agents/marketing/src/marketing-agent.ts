import { z } from "zod";
import { db, integrations } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { BaseAgent } from "@mammoth/agent-base";
import { MODELS } from "@mammoth/agent-base";
import type { AgentTaskInput, AgentTaskOutput } from "@mammoth/agent-base";

const BlogPostOutputSchema = z.object({
  title: z.string(),
  slug: z.string(),
  metaDescription: z.string().max(160),
  targetKeyword: z.string(),
  body: z.string(),
  seoScore: z.number().int().min(0).max(100),
});

const SocialPostOutputSchema = z.object({
  linkedinPost: z.string().max(3000),
  twitterPost: z.string().max(280),
});

type MarketingTaskType = "blog_post" | "social_post" | "email_newsletter";

/**
 * Marketing Agent — SEO content, social posts.
 * Uses Exa for live market trends when connected.
 * Social posts create two separate approvals (LinkedIn + Twitter) so each
 * can be dispatched independently by the execution worker.
 * All output is Ring 2 (4h veto before publish).
 */
export class MarketingAgent extends BaseAgent {
  constructor() {
    super("Marketing", MODELS.HAIKU);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as MarketingTaskType;

    if (taskType === "blog_post") return this.writeBlogPost(input);
    if (taskType === "social_post") return this.writeSocialPosts(input);

    throw new Error(`Marketing agent does not handle task type: ${taskType}`);
  }

  /**
   * Loads live market and trend context from Exa to ground blog + campaign research.
   * Returns empty string when Exa is not connected — degrades gracefully.
   */
  private async loadMarketContext(query: string): Promise<string> {
    const integration = await db.query.integrations.findFirst({
      where: and(
        eq(integrations.companyId, this.runCtx.companyId),
        eq(integrations.provider, "exa"),
        eq(integrations.status, "connected")
      ),
      columns: { accessTokenEnc: true },
    });

    if (!integration?.accessTokenEnc) return "";

    const { searchWeb, formatSearchResultsForPrompt } = await import("@mammoth/tool-exa");
    const { decryptToken } = await import("@mammoth/tool-oauth");

    let apiKey: string;
    try {
      apiKey = decryptToken(integration.accessTokenEnc);
    } catch {
      return "";
    }

    const results = await searchWeb(apiKey, {
      query,
      numResults: 5,
      includeText: true,
      startPublishedDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    });

    return formatSearchResultsForPrompt(results, 2000);
  }

  private async writeBlogPost(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { keyword, angle } = input.parameters as {
      keyword: string;
      angle?: string;
    };

    const liveContext = await this.loadMarketContext(
      `${keyword} trends insights 2025 marketing content`
    );

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(MARKETING_ROLE),
      userMessage: `Write a complete, SEO-optimized blog post.

Target keyword: "${keyword}"
${angle ? `Angle/thesis: ${angle}` : ""}
${liveContext ? `\nLive market context (use for data points and framing):\n<external_data source="live_web_search">\n${liveContext}\n</external_data>` : ""}

Requirements:
- 1,200-1,800 words
- H2 and H3 subheadings for scannability
- Introduction that hooks within first 2 sentences
- One concrete data point or statistic per section (use live context above if available)
- Conclusion with a clear call-to-action
- Write in the company's exact brand voice
- Do NOT use generic filler phrases ("In today's world...", "It's no secret...")

Return ONLY this JSON (no extra text):
{
  "title": "exact blog post title",
  "slug": "url-slug-kebab-case",
  "metaDescription": "meta description under 160 chars",
  "targetKeyword": "${keyword}",
  "body": "full markdown body",
  "seoScore": 0-100
}`,
      maxTokens: 6000,
    });

    const parsed = this.parseBlogOutput(result.content);

    const approvalId = await this.createApproval({
      actionType: "publish_blog_post",
      outputContent: `# ${parsed.title}\n\n${parsed.body}`,
      ringLevel: 2,
      confidence: parsed.seoScore / 100,
    });

    return {
      content: `# ${parsed.title}\n\n${parsed.body}`,
      summary: {
        title: parsed.title,
        slug: parsed.slug,
        keyword: parsed.targetKeyword,
        seoScore: parsed.seoScore,
        wordCount: parsed.body.split(/\s+/).length,
        approvalId,
      },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "publish_blog_post",
      confidence: parsed.seoScore / 100,
    };
  }

  private async writeSocialPosts(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { topic, sourceUrl } = input.parameters as {
      topic: string;
      sourceUrl?: string;
    };

    const liveContext = await this.loadMarketContext(
      `${topic} social media marketing insights 2025`
    );

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(MARKETING_ROLE),
      userMessage: `Write social media posts for both LinkedIn and Twitter/X.

Topic: "${topic}"
${sourceUrl ? `Source URL to reference: ${sourceUrl}` : ""}
${liveContext ? `\nLive context:\n<external_data source="live_web_search">\n${liveContext}\n</external_data>` : ""}

LinkedIn post: professional, insight-led, 3-5 paragraphs, include 3-5 relevant hashtags
Twitter/X post: concise, punchy, max 280 characters, no hashtag spam (max 2)

Return ONLY this JSON:
{
  "linkedinPost": "full linkedin post text",
  "twitterPost": "tweet text under 280 chars"
}`,
      maxTokens: 2000,
    });

    const parsed = this.parseSocialOutput(result.content);

    // Two separate approvals — each dispatches independently to its platform
    const linkedinApprovalId = await this.createApproval({
      actionType: "post_linkedin",
      outputContent: parsed.linkedinPost,
      ringLevel: 2,
      confidence: 0.8,
    });

    const twitterApprovalId = await this.createApproval({
      actionType: "post_twitter",
      outputContent: parsed.twitterPost.slice(0, 280),
      ringLevel: 2,
      confidence: 0.8,
    });

    const outputContent = `LINKEDIN:\n${parsed.linkedinPost}\n\nTWITTER:\n${parsed.twitterPost}`;

    return {
      content: outputContent,
      summary: {
        linkedinApprovalId,
        twitterApprovalId,
        linkedinLength: parsed.linkedinPost.length,
        twitterLength: parsed.twitterPost.length,
      },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "post_linkedin",
      confidence: 0.8,
    };
  }

  private parseBlogOutput(content: string): z.infer<typeof BlogPostOutputSchema> {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      return BlogPostOutputSchema.parse(JSON.parse(jsonMatch[0]));
    } catch {
      return {
        title: "Generated Blog Post",
        slug: "generated-blog-post",
        metaDescription: content.slice(0, 150),
        targetKeyword: "",
        body: content,
        seoScore: 50,
      };
    }
  }

  private parseSocialOutput(content: string): z.infer<typeof SocialPostOutputSchema> {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      return SocialPostOutputSchema.parse(JSON.parse(jsonMatch[0]));
    } catch {
      return {
        linkedinPost: content.slice(0, 2000),
        twitterPost: content.slice(0, 280),
      };
    }
  }
}

const MARKETING_ROLE = `You create high-quality, brand-consistent marketing content that drives organic growth.
Your output must feel like the founder wrote it — not generic AI content.
Every word reflects the company's brand voice, serves the active revenue goal, and is ready to publish.
Never use filler phrases, corporate jargon, or vague generalities.`;
