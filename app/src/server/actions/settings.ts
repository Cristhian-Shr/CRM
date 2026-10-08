"use server";

import bcrypt from "bcryptjs";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/db/tenant";
import { assertCan } from "@/lib/permissions";
import { parseMoney, str, todayISO } from "@/lib/utils";
import { safe } from "../safe";

async function adminCtx(action: Parameters<typeof assertCan>[1] = "settings.manage") {
  const ctx = await getContext();
  assertCan(ctx, action);
  return ctx;
}

// ───────────── Equipe ─────────────

export async function addMember(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx("team.manage");
    const email = z.string().email("E-mail inválido.").parse(str(fd, "email")?.toLowerCase());
    const role = z.enum(["admin", "collaborator"]).parse(str(fd, "role") ?? "collaborator");
    let user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (!user) {
      const name = z.string().min(2, "Informe o nome.").parse(str(fd, "name"));
      const password = z.string().min(8, "A senha inicial precisa de 8 caracteres ou mais.").parse(str(fd, "password"));
      [user] = await db.insert(schema.users).values({ name, email, passwordHash: await bcrypt.hash(password, 10) }).returning();
    }
    const exists = await db.query.companyMembers.findFirst({
      where: and(eq(schema.companyMembers.companyId, ctx.companyId), eq(schema.companyMembers.userId, user.id)),
    });
    const values = {
      role,
      isSeller: fd.get("isSeller") === "on",
      isProfessional: fd.get("isProfessional") === "on",
      jobTitle: str(fd, "jobTitle"),
      color: str(fd, "color") ?? "#be5574",
      active: true,
    };
    if (exists) await db.update(schema.companyMembers).set(values).where(eq(schema.companyMembers.id, exists.id));
    else await db.insert(schema.companyMembers).values({ ...values, companyId: ctx.companyId, userId: user.id });
    await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "member.add", entity: "user", entityId: user.id });
    revalidatePath("/configuracoes/equipe");
  });
}

export async function updateMember(memberId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx("team.manage");
    const role = z.enum(["admin", "collaborator"]).parse(str(fd, "role"));
    if (memberId === ctx.memberId && role !== "admin") throw new Error("Você não pode remover o seu próprio acesso de admin.");
    await db
      .update(schema.companyMembers)
      .set({
        role,
        isSeller: fd.get("isSeller") === "on",
        isProfessional: fd.get("isProfessional") === "on",
        jobTitle: str(fd, "jobTitle"),
        color: str(fd, "color"),
      })
      .where(and(eq(schema.companyMembers.id, memberId), eq(schema.companyMembers.companyId, ctx.companyId)));
    const pwd = str(fd, "password");
    if (pwd) {
      if (pwd.length < 8) throw new Error("A nova senha precisa de 8 caracteres ou mais.");
      const m = await db.query.companyMembers.findFirst({ where: eq(schema.companyMembers.id, memberId) });
      if (m) await db.update(schema.users).set({ passwordHash: await bcrypt.hash(pwd, 10) }).where(eq(schema.users.id, m.userId));
    }
    revalidatePath("/configuracoes/equipe");
  });
}

export async function setMemberActive(memberId: string, active: boolean) {
  const ctx = await adminCtx("team.manage");
  if (memberId === ctx.memberId) return;
  await db
    .update(schema.companyMembers)
    .set({ active })
    .where(and(eq(schema.companyMembers.id, memberId), eq(schema.companyMembers.companyId, ctx.companyId)));
  revalidatePath("/configuracoes/equipe");
}

// ───────────── Empresa ─────────────

export async function saveCompany(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, ctx.companyId) });
    await db
      .update(schema.companies)
      .set({
        name: z.string().min(2, "Informe o nome.").parse(str(fd, "name")),
        legalName: str(fd, "legalName"),
        cnpj: str(fd, "cnpj"),
        phone: str(fd, "phone"),
        email: str(fd, "email"),
        settings: {
          ...(company?.settings ?? {}),
          collaboratorsSeeAllLeads: fd.get("collaboratorsSeeAllLeads") === "on",
          maxDiscountPercent: Number(str(fd, "maxDiscountPercent") ?? 100),
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.companies.id, ctx.companyId));
    revalidatePath("/", "layout");
  });
}

// ───────────── Funil ─────────────

export async function addStage(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    const stages = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.companyId, ctx.companyId));
    const kind = z.enum(["open", "won", "lost"]).parse(str(fd, "kind") ?? "open");
    // etapas abertas entram antes de ganho/perdido
    const position = kind === "open" ? Math.max(0, ...stages.filter((s) => s.kind === "open").map((s) => s.position)) + 1 : stages.length + 1;
    if (kind === "open") {
      for (const s of stages.filter((s) => s.position >= position)) {
        await db.update(schema.pipelineStages).set({ position: s.position + 1 }).where(eq(schema.pipelineStages.id, s.id));
      }
    }
    await db.insert(schema.pipelineStages).values({
      companyId: ctx.companyId,
      name: z.string().min(2, "Informe o nome da etapa.").parse(str(fd, "name")),
      color: str(fd, "color") ?? "#6366f1",
      kind,
      position,
    });
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
  });
}

export async function updateStage(stageId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    await db
      .update(schema.pipelineStages)
      .set({ name: z.string().min(2).parse(str(fd, "name")), color: str(fd, "color") ?? "#6366f1" })
      .where(and(eq(schema.pipelineStages.id, stageId), eq(schema.pipelineStages.companyId, ctx.companyId)));
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
  });
}

export async function moveStage(stageId: string, dir: -1 | 1) {
  const ctx = await adminCtx();
  const stages = await db
    .select()
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.companyId, ctx.companyId))
    .orderBy(asc(schema.pipelineStages.position));
  const i = stages.findIndex((s) => s.id === stageId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= stages.length) return;
  await db.update(schema.pipelineStages).set({ position: stages[j].position }).where(eq(schema.pipelineStages.id, stages[i].id));
  await db.update(schema.pipelineStages).set({ position: stages[i].position }).where(eq(schema.pipelineStages.id, stages[j].id));
  revalidatePath("/configuracoes");
  revalidatePath("/funil");
}

export async function deleteStage(stageId: string) {
  return safe(async () => {
    const ctx = await adminCtx();
    const [{ n }] = await db.select({ n: count() }).from(schema.deals).where(eq(schema.deals.stageId, stageId));
    if (n > 0) throw new Error("Esta etapa tem oportunidades. Mova-as antes de excluir.");
    const [{ h }] = await db
      .select({ h: count() })
      .from(schema.dealStageHistory)
      .where(eq(schema.dealStageHistory.toStage, stageId));
    if (h > 0) throw new Error("Esta etapa já tem histórico e não pode ser excluída. Renomeie-a se precisar.");
    await db.delete(schema.pipelineStages).where(and(eq(schema.pipelineStages.id, stageId), eq(schema.pipelineStages.companyId, ctx.companyId)));
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
  });
}

// ───────────── Listas simples: origens, motivos de perda, salas ─────────────

export async function addSource(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    await db.insert(schema.leadSources).values({
      companyId: ctx.companyId,
      name: z.string().min(2, "Informe o nome.").parse(str(fd, "name")),
      type: str(fd, "type") ?? "other",
    });
    revalidatePath("/configuracoes");
  });
}

export async function toggleSource(id: string, active: boolean) {
  const ctx = await adminCtx();
  await db.update(schema.leadSources).set({ active }).where(and(eq(schema.leadSources.id, id), eq(schema.leadSources.companyId, ctx.companyId)));
  revalidatePath("/configuracoes");
}

export async function addLossReason(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    await db.insert(schema.lossReasons).values({ companyId: ctx.companyId, name: z.string().min(2, "Informe o motivo.").parse(str(fd, "name")) });
    revalidatePath("/configuracoes");
  });
}

export async function addRoom(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    await db.insert(schema.rooms).values({ companyId: ctx.companyId, name: z.string().min(1, "Informe o nome da sala.").parse(str(fd, "name")) });
    revalidatePath("/configuracoes");
    revalidatePath("/agenda");
  });
}

export async function toggleRoom(id: string, active: boolean) {
  const ctx = await adminCtx();
  await db.update(schema.rooms).set({ active }).where(and(eq(schema.rooms.id, id), eq(schema.rooms.companyId, ctx.companyId)));
  revalidatePath("/configuracoes");
  revalidatePath("/agenda");
}

// ───────────── Metas ─────────────

export async function saveGoal(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    const metric = z.enum(["revenue", "deals_won", "appointments", "leads"]).parse(str(fd, "metric") ?? "revenue");
    const month = str(fd, "month") ?? todayISO().slice(0, 7);
    const target = metric === "revenue" ? parseMoney(str(fd, "target")) : Number(str(fd, "target"));
    if (!target) throw new Error("Informe o valor da meta.");
    await db.insert(schema.goals).values({ companyId: ctx.companyId, memberId: str(fd, "memberId"), metric, target, startsOn: `${month}-01` });
    revalidatePath("/configuracoes");
    revalidatePath("/dashboard");
  });
}

/** Define/edita a meta de faturamento da empresa para um mês ("AAAA-MM"). Upsert; target 0 remove. */
export async function setRevenueGoal(month: string, fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Mês inválido." };
    const startsOn = `${month}-01`;
    const target = parseMoney(str(fd, "target"));
    const existing = await db.query.goals.findFirst({
      where: and(
        eq(schema.goals.companyId, ctx.companyId),
        eq(schema.goals.metric, "revenue"),
        isNull(schema.goals.memberId),
        eq(schema.goals.startsOn, startsOn),
      ),
    });
    if (target <= 0) {
      if (existing) await db.delete(schema.goals).where(eq(schema.goals.id, existing.id));
    } else if (existing) {
      await db.update(schema.goals).set({ target }).where(eq(schema.goals.id, existing.id));
    } else {
      await db.insert(schema.goals).values({ companyId: ctx.companyId, metric: "revenue", target, startsOn });
    }
    await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "goal.revenue", entity: "goal", metadata: { month, target } });
    revalidatePath("/dashboard");
    revalidatePath("/metas");
    return { ok: true };
  });
}

// ───────────── Integrações ─────────────

export async function saveWhatsapp(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx("integrations.manage");
    const phoneNumberId = z.string().min(5, "Informe o Phone Number ID.").parse(str(fd, "phoneNumberId"));
    const token = str(fd, "token");
    const existing = await db.query.whatsappAccounts.findFirst({ where: eq(schema.whatsappAccounts.companyId, ctx.companyId) });
    if (!existing && !token) throw new Error("Informe o token de acesso.");
    const taken = await db.query.whatsappAccounts.findFirst({ where: eq(schema.whatsappAccounts.phoneNumberId, phoneNumberId) });
    if (taken && taken.companyId !== ctx.companyId) throw new Error("Este número já está conectado a outra empresa.");
    const values = {
      provider: "meta_cloud",
      displayPhone: str(fd, "displayPhone") ?? phoneNumberId,
      phoneNumberId,
      wabaId: str(fd, "wabaId"),
      defaultOwnerId: str(fd, "defaultOwnerId"),
      status: "connected",
      ...(token ? { accessTokenEnc: encrypt(token) } : {}),
    };
    if (existing) await db.update(schema.whatsappAccounts).set(values).where(eq(schema.whatsappAccounts.id, existing.id));
    else await db.insert(schema.whatsappAccounts).values({ ...values, companyId: ctx.companyId });
    await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "integration.whatsapp" });
    revalidatePath("/configuracoes/integracoes");
  });
}

export async function disconnectWhatsapp() {
  const ctx = await adminCtx("integrations.manage");
  await db.update(schema.whatsappAccounts).set({ status: "pending" }).where(eq(schema.whatsappAccounts.companyId, ctx.companyId));
  revalidatePath("/configuracoes/integracoes");
}

export async function saveMeta(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx("integrations.manage");
    let adAccountId = z.string().min(3, "Informe o ID da conta de anúncios.").parse(str(fd, "adAccountId"));
    if (!adAccountId.startsWith("act_")) adAccountId = `act_${adAccountId}`;
    const token = str(fd, "token");
    const existing = await db.query.metaConnections.findFirst({
      where: and(eq(schema.metaConnections.companyId, ctx.companyId), eq(schema.metaConnections.adAccountId, adAccountId)),
    });
    if (!existing && !token) throw new Error("Informe o token de acesso.");
    const values = { pageId: str(fd, "pageId"), status: "connected", ...(token ? { accessTokenEnc: encrypt(token) } : {}) };
    if (existing) await db.update(schema.metaConnections).set(values).where(eq(schema.metaConnections.id, existing.id));
    else await db.insert(schema.metaConnections).values({ ...values, accessTokenEnc: encrypt(token!), companyId: ctx.companyId, adAccountId });
    await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "integration.meta" });
    revalidatePath("/configuracoes/integracoes");
    revalidatePath("/campanhas");
  });
}
