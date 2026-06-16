import { z } from "zod";
import { db, approvals, companies, publishNotification } from "@mammoth/db";
import { eq } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";

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
 * Marketing Agent — generates SEO content and social posts.
 * Blog posts and newsletters are Ring 2 (4-hour veto window).
 * Social posts mentioning specific people/companies are Ring 2.
 * Internal drafts are Ring 1.
 */
export class MarketingAgent extends BaseAgent {
  constructor() {
    super("Marketing", MODELS.HAIKU);
  }

  protected async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as MarketingTaskType;

    if (taskType === "blog_post") {
      return this.writeBlogPost(input);
    }

    if (taskType === "social_post") {
      return this.writeSocialPosts(input);
    }

    throw new Error(`Marketing agent does not handle task type: ${taskType}`);
  }

  private async writeBlogPost(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { keyword, angle } = input.parameters as {
      keyword: string;
      angle?: string;
    };

    const systemPrompt = this.buildSystemPrompt(MARKETING_ROLE);
    const userMessage = `Write a complete, SEO-optimized blog post.

Target keyword: "${keyword}"
${angle ? `Angle/thesis: ${angle}` : ""}

Requirements:
- 1,200-1,800 words
- H2 and H3 subheadings for scannability
- Introduction that hooks within first 2 sentences
- One concrete data point or statistic per section
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
}`;

    const result = await this.callLlm({
      systemPrompt,
      userMessage,
      maxTokens: 6000,
    });

    const parsed = this.parseBlogOutput(result.content);

    // Blog posts require Ring 2 approval (4-hour veto before publish)
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

    const systemPrompt = this.buildSystemPrompt(MARKETING_ROLE);
    const userMessage = `Write social media posts for both LinkedIn and Twitter/X.

Topic: "${topic}"
${sourceUrl ? `Source URL to reference: ${sourceUrl}` : ""}

LinkedIn post: professional, insight-led, 3-5 paragraphs, include 3-5 relevant hashtags
Twitter/X post: concise, punchy, max 280 characters, no hashtag spam (max 2)

Return ONLY this JSON:
{
  "linkedinPost": "full linkedin post text",
  "twitterPost": "tweet text under 280 chars"
}`;

    const result = await this.callLlm({
      systemPrompt,
      userMessage,
      maxTokens: 2000,
    });

    const parsed = this.parseSocialOutput(result.content);

    return {
      content: `LINKEDIN:\n${parsed.linkedinPost}\n\nTWITTER:\n${parsed.twitterPost}`,
      summary: {
        linkedinLength: parsed.linkedinPost.length,
        twitterLength: parsed.twitterPost.length,
      },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "publish_social_post",
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

  private async createApproval(options: {
    actionType: string;
    outputContent: string;
    ringLevel: 1 | 2 | 3;
    confidence: number;
  }): Promise<string> {
    const expiresAt =
      options.ringLevel === 2
        ? new Date(Date.now() + 4 * 60 * 60 * 1000)
        : null;

    const [approval] = await db
      .insert(approvals)
      .values({
        companyId: this.runCtx.companyId,
        taskId: this.runCtx.taskId,
        department: this.departmentName.toLowerCase(),
        actionType: options.actionType,
        ringLevel: options.ringLevel,
        outputContent: options.outputContent,
        confidence: options.confidence.toString(),
        status: "pending",
        expiresAt,
      })
      .returning({ id: approvals.id });

    const approvalId = approval!.id;

    const company = await db.query.companies.findFirst({
      where: eq(companies.id, this.runCtx.companyId),
      columns: { ownerId: true },
    });

    if (company) {
      await publishNotification({
        type: "approval_created",
        userId: company.ownerId,
        approvalId,
      });
    }

    return approvalId;
  }
}

const MARKETING_ROLE = `You create high-quality, brand-consistent marketing content that drives organic growth.
Your output must feel like the founder wrote it — not generic AI content.
Every word reflects the company's brand voice, serves the active revenue goal, and is ready to publish.
Never use filler phrases, corporate jargon, or vague generalities.`;
