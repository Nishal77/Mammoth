import {
  db,
  approvals,
  users,
  notifications,
  briefings,
  metricsDaily,
  companyGoals,
} from "@mammoth/db";
import { eq, and } from "drizzle-orm";
import { sendApprovalRequest, sendBriefing, sendVetoAlert } from "./telegram/telegram-bot.ts";
import {
  sendWhatsAppApproval,
  sendWhatsAppBriefing,
  sendWhatsAppVetoAlert,
} from "./whatsapp/whatsapp-client.ts";

/**
 * Shape of the notifyPrefs JSON column stored on users.
 * telegram/whatsapp flags control which channel receives each notification type.
 */
type NotifyPrefs = {
  telegram: boolean;
  whatsapp: boolean;
};

export type NotificationPayload =
  | {
      type: "approval_created";
      userId: string;
      approvalId: string;
    }
  | {
      type: "veto_alert";
      userId: string;
      approvalId: string;
      minutesLeft: number;
    }
  | {
      type: "briefing_ready";
      userId: string;
      briefingId: string;
    };

/**
 * Routes a notification to the founder's configured channel.
 * Telegram is primary. Falls back to WhatsApp. Email is never used for approvals.
 * Records delivery to the notifications table.
 */
export async function dispatch(payload: NotificationPayload): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
    columns: {
      id: true,
      email: true,
      notifyPrefs: true,
      telegramChatId: true,
      whatsappPhone: true,
    },
  });

  if (!user) return;

  // notifyPrefs is stored as JSONB — cast to our known shape.
  const prefs = user.notifyPrefs as NotifyPrefs;
  const usedChannels: Array<"telegram" | "whatsapp" | "email" | "in_app"> = [
    "in_app",
  ];

  if (payload.type === "approval_created") {
    await dispatchApproval(user, payload.approvalId, prefs, usedChannels);
  } else if (payload.type === "veto_alert") {
    await dispatchVetoAlert(user, payload.approvalId, payload.minutesLeft, prefs, usedChannels);
  } else if (payload.type === "briefing_ready") {
    await dispatchBriefing(user, payload.briefingId, prefs, usedChannels);
  }

  await recordNotification(payload, user.id, usedChannels);
}

async function dispatchApproval(
  user: { telegramChatId: string | null; whatsappPhone: string | null },
  approvalId: string,
  prefs: NotifyPrefs,
  usedChannels: Array<"telegram" | "whatsapp" | "email" | "in_app">
): Promise<void> {
  const approval = await db.query.approvals.findFirst({
    where: eq(approvals.id, approvalId),
    columns: {
      department: true,
      actionType: true,
      ringLevel: true,
      outputContent: true,
      confidence: true,
      expiresAt: true,
    },
  });

  if (!approval) return;

  const approvalData = {
    approvalId,
    department: approval.department,
    actionType: approval.actionType,
    ringLevel: approval.ringLevel,
    outputContent: approval.outputContent,
    confidence: Number(approval.confidence ?? 0.7),
    expiresAt: approval.expiresAt,
  };

  if (prefs.telegram && user.telegramChatId) {
    await sendApprovalRequest(user.telegramChatId, approvalData);
    usedChannels.push("telegram");
  } else if (prefs.whatsapp && user.whatsappPhone) {
    await sendWhatsAppApproval(user.whatsappPhone, approvalData);
    usedChannels.push("whatsapp");
  }
}

async function dispatchVetoAlert(
  user: { telegramChatId: string | null; whatsappPhone: string | null },
  approvalId: string,
  minutesLeft: number,
  prefs: NotifyPrefs,
  usedChannels: Array<"telegram" | "whatsapp" | "email" | "in_app">
): Promise<void> {
  const approval = await db.query.approvals.findFirst({
    where: eq(approvals.id, approvalId),
    columns: { department: true, actionType: true },
  });

  if (!approval) return;

  const alertData = {
    approvalId,
    department: approval.department,
    actionType: approval.actionType,
    minutesLeft,
  };

  if (prefs.telegram && user.telegramChatId) {
    await sendVetoAlert(user.telegramChatId, alertData);
    usedChannels.push("telegram");
  } else if (prefs.whatsapp && user.whatsappPhone) {
    await sendWhatsAppVetoAlert(user.whatsappPhone, alertData);
    usedChannels.push("whatsapp");
  }
}

async function dispatchBriefing(
  user: { telegramChatId: string | null; whatsappPhone: string | null },
  briefingId: string,
  prefs: NotifyPrefs,
  usedChannels: Array<"telegram" | "whatsapp" | "email" | "in_app">
): Promise<void> {
  const briefing = await db.query.briefings.findFirst({
    where: eq(briefings.id, briefingId),
    columns: {
      summary: true,
      briefingDate: true,
      companyId: true,
    },
  });

  if (!briefing) return;

  const [latestMetric, activeGoal] = await Promise.all([
    db.query.metricsDaily.findFirst({
      where: eq(metricsDaily.companyId, briefing.companyId),
      orderBy: (m, { desc }) => [desc(m.date)],
      columns: { mrr: true },
    }),
    db.query.companyGoals.findFirst({
      where: and(
        eq(companyGoals.companyId, briefing.companyId),
        eq(companyGoals.status, "active")
      ),
      columns: { title: true, targetValue: true, unit: true },
    }),
  ]);

  const pendingCount = await db.$count(
    approvals,
    and(
      eq(approvals.companyId, briefing.companyId),
      eq(approvals.status, "pending")
    )
  );

  const briefingPayload = {
    summary: briefing.summary,
    mrr: latestMetric?.mrr ? `$${latestMetric.mrr}` : "—",
    goal: activeGoal
      ? `${activeGoal.targetValue} ${activeGoal.unit} — ${activeGoal.title}`
      : "No active goal",
    pendingApprovals: pendingCount,
    briefingDate: String(briefing.briefingDate),
  };

  if (prefs.telegram && user.telegramChatId) {
    await sendBriefing(user.telegramChatId, briefingPayload);
    usedChannels.push("telegram");
  } else if (prefs.whatsapp && user.whatsappPhone) {
    await sendWhatsAppBriefing(user.whatsappPhone, briefingPayload);
    usedChannels.push("whatsapp");
  }
}

async function recordNotification(
  payload: NotificationPayload,
  userId: string,
  channels: Array<"telegram" | "whatsapp" | "email" | "in_app">
): Promise<void> {
  const typeLabels: Record<NotificationPayload["type"], string> = {
    approval_created: "Approval Request",
    veto_alert: "Veto Window Closing",
    briefing_ready: "Morning Briefing",
  };

  const companyId = await resolveCompanyId(payload);
  if (!companyId) return;

  await db.insert(notifications).values({
    userId,
    companyId,
    type: payload.type,
    title: typeLabels[payload.type],
    channels,
    read: 0,
  });
}

async function resolveCompanyId(
  payload: NotificationPayload
): Promise<string | null> {
  if (payload.type === "approval_created" || payload.type === "veto_alert") {
    const approval = await db.query.approvals.findFirst({
      where: eq(approvals.id, payload.approvalId),
      columns: { companyId: true },
    });
    return approval?.companyId ?? null;
  }

  if (payload.type === "briefing_ready") {
    const briefing = await db.query.briefings.findFirst({
      where: eq(briefings.id, payload.briefingId),
      columns: { companyId: true },
    });
    return briefing?.companyId ?? null;
  }

  return null;
}
