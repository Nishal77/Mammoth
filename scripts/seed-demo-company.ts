/**
 * Seeds a demo company with all 9 departments, company memory, an active goal,
 * sample metrics, and a demo user. Run with: npx tsx scripts/seed-demo-company.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../packages/db/src/schema/index.ts";
import { eq } from "drizzle-orm";

const {
  users,
  companies,
  companyMemory,
  companyGoals,
  departments,
  metrics,
  trustScores,
} = schema;

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
const db = drizzle(pool, { schema });

const DEMO_USER_EMAIL = "demo@mammoth.ai";
const DEMO_COMPANY_NAME = "Acme Inc.";

const DEPARTMENT_NAMES = [
  "ceo",
  "marketing",
  "sales",
  "engineering",
  "support",
  "finance",
  "research",
  "hr",
  "content",
] as const;

async function seed(): Promise<void> {
  console.log("Seeding demo company...");

  // 1. Upsert demo user
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, DEMO_USER_EMAIL),
    columns: { id: true },
  });

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    console.log(`Using existing user: ${userId}`);
  } else {
    const [user] = await db
      .insert(users)
      .values({
        id: uuidv4(),
        email: DEMO_USER_EMAIL,
        name: "Demo Founder",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: users.id });

    userId = user!.id;
    console.log(`Created demo user: ${userId}`);
  }

  // 2. Upsert demo company
  const existingCompany = await db.query.companies.findFirst({
    where: eq(companies.ownerId, userId),
    columns: { id: true },
  });

  let companyId: string;

  if (existingCompany) {
    companyId = existingCompany.id;
    console.log(`Using existing company: ${companyId}`);
  } else {
    const [company] = await db
      .insert(companies)
      .values({
        id: uuidv4(),
        ownerId: userId,
        name: DEMO_COMPANY_NAME,
        industry: "B2B SaaS",
        stage: "seed",
        website: "https://acme.example.com",
        description: "AI-powered workflow automation for SMBs.",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: companies.id });

    companyId = company!.id;
    console.log(`Created demo company: ${companyId}`);
  }

  // 3. Seed company memory
  const memoryEntries: Array<{ memoryType: string; key: string; value: string }> = [
    {
      memoryType: "identity",
      key: "mission",
      value: "Help small businesses automate repetitive work so humans can focus on relationships.",
    },
    {
      memoryType: "identity",
      key: "values",
      value: JSON.stringify(["transparency", "customer-first", "bias-to-action", "no-bloat"]),
    },
    {
      memoryType: "brand",
      key: "voice",
      value: "Direct, warm, no jargon. Write like a smart colleague, not a corporation.",
    },
    {
      memoryType: "brand",
      key: "messaging_pillars",
      value: JSON.stringify([
        "Save 10+ hours per week",
        "No code required",
        "Works with tools you already use",
      ]),
    },
    {
      memoryType: "customer",
      key: "primary_persona",
      value: JSON.stringify({
        name: "Operations Manager at a 20-person B2B company",
        painPoints: [
          "Spends 3h/day on manual data entry",
          "Misses follow-ups because tasks fall through the cracks",
          "Can't afford full-time ops hire",
        ],
      }),
    },
    {
      memoryType: "competitor",
      key: "landscape",
      value: JSON.stringify({
        primary: ["Zapier", "Make.com", "n8n"],
        gaps: ["SMB-friendly pricing", "built-in AI agents", "no-setup workflows"],
      }),
    },
  ];

  for (const entry of memoryEntries) {
    await db
      .insert(companyMemory)
      .values({
        id: uuidv4(),
        companyId,
        memoryType: entry.memoryType,
        key: entry.key,
        value: entry.value,
        source: "seed",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [companyMemory.companyId, companyMemory.memoryType, companyMemory.key],
        set: { value: entry.value, updatedAt: new Date() },
      });
  }
  console.log(`Seeded ${memoryEntries.length} memory entries`);

  // 4. Seed active goal
  await db
    .insert(companyGoals)
    .values({
      id: uuidv4(),
      companyId,
      title: "Reach $10k MRR",
      type: "revenue",
      targetValue: "10000",
      currentValue: "2400",
      unit: "USD/month",
      deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  console.log("Seeded active goal");

  // 5. Seed departments
  for (const deptName of DEPARTMENT_NAMES) {
    await db
      .insert(departments)
      .values({
        id: uuidv4(),
        companyId,
        name: deptName,
        status: "active",
        ringLevel: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${DEPARTMENT_NAMES.length} departments`);

  // 6. Seed trust scores for each department's common action types
  const trustScoreDefaults = [
    { department: "marketing", actionType: "publish_campaign" },
    { department: "marketing", actionType: "publish_social_post" },
    { department: "sales", actionType: "send_outreach_sequence" },
    { department: "content", actionType: "publish_blog_post" },
    { department: "content", actionType: "post_linkedin" },
    { department: "support", actionType: "send_support_reply" },
  ];

  for (const ts of trustScoreDefaults) {
    await db
      .insert(trustScores)
      .values({
        id: uuidv4(),
        companyId,
        department: ts.department,
        actionType: ts.actionType,
        ringLevel: 2,
        consecutiveUnmodified: 0,
        totalApprovals: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${trustScoreDefaults.length} trust score records`);

  // 7. Seed sample metrics
  const now = Date.now();
  for (let i = 6; i >= 0; i--) {
    const recordedAt = new Date(now - i * 7 * 24 * 60 * 60 * 1000);
    const mrr = (2400 - i * 80).toString();
    const totalRevenue = (2400 - i * 80 + 400).toString();

    await db
      .insert(metrics)
      .values({
        id: uuidv4(),
        companyId,
        mrr,
        totalRevenue,
        totalLeads: 12 + (6 - i) * 3,
        totalCustomers: 8 + (6 - i),
        totalTasks: (6 - i) * 24,
        recordedAt,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }
  console.log("Seeded 7 weeks of metrics");

  console.log("\nSeed complete.");
  console.log(`  User: ${DEMO_USER_EMAIL}`);
  console.log(`  Company: ${DEMO_COMPANY_NAME} (${companyId})`);
  console.log(`  Login at http://localhost:3000/login`);

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
