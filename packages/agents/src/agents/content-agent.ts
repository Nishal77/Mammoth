import { z } from "zod";
import { db, companyMemory } from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import { BaseAgent } from "../base/base-agent.ts";
import { MODELS } from "../router/model-router.ts";
import type { AgentTaskInput, AgentTaskOutput } from "../base/base-agent.ts";

const BlogPostSchema = z.object({
  title: z.string(),
  slug: z.string(),
  metaDescription: z.string().max(160),
  targetKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  outline: z.array(z.string()),
  content: z.string(),
  estimatedReadTime: z.number(),
});

const SocialPostSchema = z.object({
  platform: z.enum(["twitter", "linkedin", "instagram"]),
  content: z.string(),
  hashtags: z.array(z.string()),
  callToAction: z.string().optional(),
});

type ContentTaskType = "blog_post" | "social_post" | "seo_audit" | "content_calendar";

/**
 * Content Agent — blog posts, social media, SEO content.
 * All published content is Ring 2 (4h veto window before it goes live).
 */
export class ContentAgent extends BaseAgent {
  constructor() {
    super("Content", MODELS.HAIKU);
  }

  protected override async execute(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const taskType = input.taskType as ContentTaskType;

    if (taskType === "blog_post") return this.writeBlogPost(input);
    if (taskType === "social_post") return this.writeSocialPost(input);
    if (taskType === "content_calendar") return this.buildContentCalendar(input);

    throw new Error(`Content agent does not handle task type: ${taskType}`);
  }

  private async writeBlogPost(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { topic, keyword, audience, tone } = input.parameters as {
      topic: string;
      keyword?: string;
      audience?: string;
      tone?: string;
    };

    // Load brand_voice memory for tone consistency across all content
    const brandMemory = await db.query.companyMemory.findFirst({
      where: and(
        eq(companyMemory.companyId, this.runCtx.companyId),
        eq(companyMemory.memoryType, "brand_voice")
      ),
    });

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(CONTENT_ROLE),
      userMessage: `Write a complete SEO-optimized blog post.

Topic: "${topic}"
${keyword ? `Target keyword: "${keyword}"` : ""}
${audience ? `Audience: ${audience}` : ""}
${tone ? `Tone: ${tone}` : ""}
${brandMemory ? `Brand voice guidance: ${String(brandMemory.value).slice(0, 500)}` : ""}

Requirements:
- 1200-1800 words
- Keyword in title, first paragraph, one H2
- Natural language, no keyword stuffing
- Actionable, specific — no generic advice
- Strong hook in first paragraph

Return ONLY this JSON:
{
  "title": "...",
  "slug": "...",
  "metaDescription": "...",
  "targetKeyword": "...",
  "secondaryKeywords": ["..."],
  "outline": ["H1: ...", "H2: ...", "H2: ..."],
  "content": "...",
  "estimatedReadTime": 7
}`,
      maxTokens: 4000,
    });

    const parsed = this.parseBlogPost(result.content);

    const approvalId = await this.createApproval({
      actionType: "publish_blog_post",
      outputContent: `# ${parsed.title}\n\nSlug: /${parsed.slug}\nMeta: ${parsed.metaDescription}\n\n${parsed.content}`,
      ringLevel: 2,
      confidence: 0.82,
    });

    return {
      content: `${parsed.title} (${parsed.estimatedReadTime} min read)`,
      summary: { approvalId, title: parsed.title, slug: parsed.slug, keyword: parsed.targetKeyword },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "publish_blog_post",
      confidence: 0.82,
    };
  }

  private async writeSocialPost(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { topic, platform, context } = input.parameters as {
      topic: string;
      platform: "twitter" | "linkedin" | "instagram";
      context?: string;
    };

    // Load brand_voice memory for tone consistency
    const brandMemory = await db.query.companyMemory.findFirst({
      where: and(
        eq(companyMemory.companyId, this.runCtx.companyId),
        eq(companyMemory.memoryType, "brand_voice")
      ),
    });

    const charLimits: Record<string, number> = {
      twitter: 280,
      linkedin: 3000,
      instagram: 2200,
    };

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(CONTENT_ROLE),
      userMessage: `Write a ${platform} post.

Topic: "${topic}"
Character limit: ${charLimits[platform]}
${context ? `Context: ${context}` : ""}
${brandMemory ? `Brand voice guidance: ${String(brandMemory.value).slice(0, 300)}` : ""}

Rules:
- ${platform === "twitter" ? "Short, punchy, direct. One idea per tweet." : ""}
- ${platform === "linkedin" ? "Professional but human. First line must hook. No buzzwords." : ""}
- ${platform === "instagram" ? "Visual-friendly. Engaging caption. Hashtags at end." : ""}
- No corporate speak. Sound like a person.

Return ONLY this JSON:
{
  "platform": "${platform}",
  "content": "...",
  "hashtags": ["...", "..."],
  "callToAction": "..."
}`,
      maxTokens: 800,
    });

    const parsed = this.parseSocialPost(result.content);
    const fullContent = `${parsed.content}\n\n${parsed.hashtags.map((h) => `#${h}`).join(" ")}`;

    const approvalId = await this.createApproval({
      actionType: `post_${platform}`,
      outputContent: fullContent,
      ringLevel: 2,
      confidence: 0.8,
    });

    return {
      content: fullContent.slice(0, 200),
      summary: { approvalId, platform, hashtags: parsed.hashtags },
      approvalRequired: true,
      ringLevel: 2,
      actionType: `post_${platform}`,
      confidence: 0.8,
    };
  }

  private async buildContentCalendar(input: AgentTaskInput): Promise<AgentTaskOutput> {
    const { weeks = 4, focusThemes } = input.parameters as {
      weeks?: number;
      focusThemes?: string[];
    };

    const result = await this.callLlm({
      systemPrompt: this.buildSystemPrompt(CONTENT_ROLE),
      userMessage: `Create a ${weeks}-week content calendar.

${focusThemes ? `Focus themes: ${focusThemes.join(", ")}` : ""}

For each week, plan: 1 blog post idea, 3 LinkedIn posts, 5 Twitter posts.
Be specific — no filler topics. Each topic should serve a clear business goal.

Return a structured plan in markdown.`,
      maxTokens: 3000,
    });

    const approvalId = await this.createApproval({
      actionType: "approve_content_calendar",
      outputContent: result.content,
      ringLevel: 2,
      confidence: 0.78,
    });

    return {
      content: `${weeks}-week content calendar generated`,
      summary: { approvalId, weeks },
      approvalRequired: true,
      ringLevel: 2,
      actionType: "approve_content_calendar",
      confidence: 0.78,
    };
  }

  private parseBlogPost(content: string): z.infer<typeof BlogPostSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return BlogPostSchema.parse(JSON.parse(match[0]));
    } catch {
      return {
        title: "Untitled",
        slug: "untitled",
        metaDescription: "",
        targetKeyword: "",
        secondaryKeywords: [],
        outline: [],
        content,
        estimatedReadTime: 5,
      };
    }
  }

  private parseSocialPost(content: string): z.infer<typeof SocialPostSchema> {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      return SocialPostSchema.parse(JSON.parse(match[0]));
    } catch {
      return { platform: "linkedin", content, hashtags: [] };
    }
  }
}

const CONTENT_ROLE = `You write content that ranks, converts, and sounds human.
No generic advice. Every piece is specific to the audience, topic, and business goal.
You understand SEO but you write for people first, search engines second.`;
