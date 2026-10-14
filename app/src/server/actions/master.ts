"use server";

import bcrypt from "bcryptjs";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession, requireMaster, setSession } from "@/lib/auth";
import { db, schema, type Tx } from "@/lib/db";
import { audit } from "@/lib/db/tenant";
import { normalizePhone, parseMoney, str, todayISO } from "@/lib/utils";
import { billingMonths, parseCompanyServices, PAYMENT_METHOD_KEYS } from "@/lib/services";
import { provisionCompany } from "../provision";
import { safe } from "../safe";

/** Sincroniza os serviços contratados de uma empresa (apaga e regrava). */
async function syncCompanyServices(
  tx: Tx,
  companyId: string,
  services: { service: string; valueCents: number; billing: string; installments: number }[],
) {
  await tx.delete(schema.companyServices).where(eq(schema.companyServices.companyId, companyId));
  if (services.length)
    await tx.insert(schema.companyServices).values(services.map((s) => ({ ...s, companyId })));
}

/**
 * (Re)gera a agenda de pagamentos de uma empresa conforme a recorrência de cada serviço.
 * Vencimento = mesmo dia da venda. Horizonte de 24 meses. Preserva os já pagos (não duplica
 * períodos pagos; único só gera se ainda não foi pago). Apaga os pendentes antes de regerar.
 */
const SCHEDULE_HORIZON_MONTHS = 12;

async function ensureScheduleForServices(
  tx: Tx,
  companyId: string,
  services: { service: string; valueCents: number; billing: string; installments: number }[],
) {
  const active = services.filter((s) => s.valueCents > 0);
  const existing = await tx
    .select({ service: schema.servicePayments.service, status: schema.servicePayments.status, dueDate: schema.servicePayments.dueDate })
    .from(schema.servicePayments)
    .where(eq(schema.servicePayments.companyId, companyId));
  const paidKeys = new Set(existing.filter((e) => e.status === "paid").map((e) => `${e.service}|${e.dueDate}`));
  const paidByService = new Set(existing.filter((e) => e.status === "paid").map((e) => e.service));

  // Remove os pendentes dos SERVIÇOS (não os "extra") — serão regerados conforme a recorrência. Os pagos ficam.
  await tx
    .delete(schema.servicePayments)
    .where(
      and(
        eq(schema.servicePayments.companyId, companyId),
        eq(schema.servicePayments.status, "pending"),
        ne(schema.servicePayments.service, "extra"),
      ),
    );

  const [y, m, d] = todayISO().split("-").map(Number);
  const base = y * 12 + (m - 1);
  const rows: { companyId: string; service: string; dueDate: string; valueCents: number }[] = [];
  for (const s of active) {
    const interval = billingMonths(s.billing);
    if (interval === 0) {
      if (paidByService.has(s.service)) continue; // único já pago uma vez
      rows.push({ companyId, service: s.service, dueDate: clampYmd(y, m - 1, d), valueCents: s.valueCents });
      continue;
    }
    // Nº de parcelas definido no serviço (ex.: 12 mensais, 4 trimestrais...).
    const count = s.installments && s.installments >= 1 ? s.installments : 12;
    for (let i = 0; i < count; i++) {
      const cur = base + i * interval;
      const dueDate = clampYmd(Math.floor(cur / 12), cur % 12, d);
      if (paidKeys.has(`${s.service}|${dueDate}`)) continue; // não duplica período já pago
      rows.push({ companyId, service: s.service, dueDate, valueCents: s.valueCents });
    }
  }
  if (rows.length) await tx.insert(schema.servicePayments).values(rows);
}

/** Lê e valida a forma de pagamento do formulário (null se vazia/inválida). */
function parsePaymentMethod(fd: FormData): string | null {
  const pm = str(fd, "paymentMethod");
  return pm && PAYMENT_METHOD_KEYS.includes(pm) ? pm : null;
}

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createCompany(fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const data = z
      .object({ name: z.string().min(2, "Informe o nome da empresa.") })
      .parse({ name: str(fd, "name") });

    let slug = slugify(data.name) || "empresa";
    const exists = await db.query.companies.findFirst({ where: eq(schema.companies.slug, slug) });
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;

    const services = parseCompanyServices(fd, parseMoney);

    await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(schema.companies)
        .values({
          name: data.name,
          slug,
          cnpj: str(fd, "cnpj"),
          phone: normalizePhone(str(fd, "phone")),
          email: str(fd, "email"),
          plan: str(fd, "plan") ?? "basic",
          paymentMethod: parsePaymentMethod(fd),
        })
        .returning();
      await provisionCompany(tx, company.id);
      await syncCompanyServices(tx, company.id, services);
      await ensureScheduleForServices(tx, company.id, services);
      await audit(tx, { userId: user.id, companyId: company.id, action: "company.create", entity: "company", entityId: company.id });
    });
    // Usuários da empresa são cadastrados depois, na tela de Usuários.
    revalidatePath("/master");
    revalidatePath("/master/empresas");
    revalidatePath("/master/vendas");
    revalidatePath("/master/comandas");
    revalidatePath("/master/faturamento");
  });
}

export async function setCompanyStatus(companyId: string, status: "active" | "suspended") {
  const { user } = await requireMaster();
  if (status !== "active" && status !== "suspended") return;
  await db.update(schema.companies).set({ status, updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
  await audit(db, { userId: user.id, companyId, action: `company.${status}`, entity: "company", entityId: companyId });
  revalidatePath("/master");
  revalidatePath("/master/empresas");
  revalidatePath("/master/vendas");
  revalidatePath("/master/comandas");
  revalidatePath("/master/faturamento");
}

export async function setCompanyServices(companyId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const services = parseCompanyServices(fd, parseMoney);
    await db.transaction(async (tx) => {
      await syncCompanyServices(tx, companyId, services);
      await ensureScheduleForServices(tx, companyId, services);
      await tx
        .update(schema.companies)
        .set({ paymentMethod: parsePaymentMethod(fd), updatedAt: new Date() })
        .where(eq(schema.companies.id, companyId));
      await audit(tx, { userId: user.id, companyId, action: "company.services", entity: "company", entityId: companyId });
    });
    revalidatePath("/master");
    revalidatePath("/master/empresas");
    revalidatePath("/master/vendas");
    revalidatePath("/master/comandas");
    revalidatePath("/master/faturamento");
  });
}

// Tabelas com company_id, em ordem de dependência (filhas primeiro) para o delete em cascata.
// order_items e program_items não têm company_id: somem via ON DELETE cascade de orders/programs.
const COMPANY_CHILD_TABLES = [
  "messages",
  "conversations",
  "appointments",
  "contracted_sessions",
  "receivables",
  "quotes",
  "orders",
  "tasks",
  "activities",
  "deal_stage_history",
  "deals",
  "goals",
  "notifications",
  "meta_insights_daily",
  "meta_campaigns",
  "meta_connections",
  "whatsapp_accounts",
  "contacts",
  "programs",
  "procedures",
  "rooms",
  "pipeline_stages",
  "lead_sources",
  "loss_reasons",
  "company_services",
  "service_payments",
  "company_members",
  "audit_logs",
] as const;

/** Exclui uma empresa e TODOS os dados dela. Irreversível. Exige confirmação com o nome exato. */
export async function deleteCompany(companyId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, companyId) });
    if (!company) return { error: "Empresa não encontrada." };
    if (str(fd, "confirm") !== company.name) return { error: "Digite o nome exato da empresa para confirmar." };

    await db.transaction(async (tx) => {
      for (const table of COMPANY_CHILD_TABLES) {
        await tx.execute(sql`delete from ${sql.identifier(table)} where company_id = ${companyId}`);
      }
      await tx.delete(schema.companies).where(eq(schema.companies.id, companyId));
    });
    // Audit após o commit, sem companyId (a empresa já não existe).
    await audit(db, { userId: user.id, action: "company.delete", entity: "company", metadata: { id: companyId, name: company.name } });
    revalidatePath("/master");
    revalidatePath("/master/empresas");
    revalidatePath("/master/vendas");
    revalidatePath("/master/comandas");
    revalidatePath("/master/faturamento");
    return { ok: true };
  });
}

export async function enterCompany(companyId: string) {
  const { user } = await requireMaster();
  const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, companyId) });
  if (!company) return;
  await audit(db, { userId: user.id, companyId, action: "impersonate", entity: "company", entityId: companyId });
  await setSession({ userId: user.id, isMaster: true, activeCompanyId: companyId, impersonating: true });
  redirect("/dashboard");
}

export async function leaveCompany() {
  const session = await getSession();
  if (!session) redirect("/login");
  await setSession({ userId: session.userId, isMaster: session.isMaster, activeCompanyId: null });
  redirect(session.isMaster ? "/master" : "/selecionar-empresa");
}

/** Cria um usuário e o vincula a uma empresa com um nível de acesso. */
export async function createUser(fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const data = z
      .object({
        name: z.string().min(2, "Informe o nome."),
        email: z.string().email("E-mail inválido."),
        companyId: z.string().uuid("Selecione a empresa."),
        role: z.enum(["admin", "collaborator"]),
        password: z.string().optional(),
      })
      .parse({
        name: str(fd, "name") ?? "",
        email: (str(fd, "email") ?? "").toLowerCase(),
        companyId: str(fd, "companyId") ?? "",
        role: str(fd, "role") ?? "collaborator",
        password: str(fd, "password") ?? undefined,
      });

    const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, data.companyId) });
    if (!company) return { error: "Empresa não encontrada." };

    await db.transaction(async (tx) => {
      let target = await tx.query.users.findFirst({ where: eq(schema.users.email, data.email) });
      if (!target) {
        if (!data.password || data.password.length < 8) throw new Error("Defina uma senha de ao menos 8 caracteres.");
        [target] = await tx
          .insert(schema.users)
          .values({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 10) })
          .returning();
      }
      const member = await tx.query.companyMembers.findFirst({
        where: and(eq(schema.companyMembers.companyId, data.companyId), eq(schema.companyMembers.userId, target.id)),
      });
      if (member) throw new Error("Esse usuário já tem acesso a essa empresa.");
      await tx
        .insert(schema.companyMembers)
        .values({ companyId: data.companyId, userId: target.id, role: data.role, color: "#7c3aed" });
      await audit(tx, { userId: user.id, companyId: data.companyId, action: "user.create", entity: "user", entityId: target.id });
    });
    revalidatePath("/master/usuarios");
    revalidatePath("/master/empresas");
    return { ok: true };
  });
}

export async function updateUser(userId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const data = z
      .object({
        name: z.string().min(2, "Informe o nome."),
        email: z.string().email("E-mail inválido."),
        password: z.string().min(8, "A senha precisa de ao menos 8 caracteres.").optional(),
      })
      .parse({
        name: str(fd, "name") ?? "",
        email: (str(fd, "email") ?? "").toLowerCase(),
        password: str(fd, "password") ?? undefined,
      });

    const dup = await db.query.users.findFirst({ where: eq(schema.users.email, data.email) });
    if (dup && dup.id !== userId) return { error: "E-mail já usado por outro usuário." };

    const patch: { name: string; email: string; passwordHash?: string } = { name: data.name, email: data.email };
    if (data.password) patch.passwordHash = await bcrypt.hash(data.password, 10);

    await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
    await audit(db, {
      userId: user.id,
      action: "user.update",
      entity: "user",
      entityId: userId,
      metadata: { passwordChanged: !!data.password },
    });
    revalidatePath("/master/usuarios");
    return { ok: true };
  });
}

export async function setUserStatus(userId: string, status: "active" | "disabled") {
  const { user } = await requireMaster();
  if (status !== "active" && status !== "disabled") return;
  if (userId === user.id) return;
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, userId));
  await audit(db, { userId: user.id, action: `user.${status}`, entity: "user", entityId: userId });
  revalidatePath("/master/usuarios");
  revalidatePath("/master/empresas");
}

/** Exclui um usuário de vez. Preserva o histórico anonimizado (referências viram nulas). Irreversível. */
export async function deleteUser(userId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    if (userId === user.id) return { error: "Você não pode excluir o seu próprio usuário." };
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!target) return { error: "Usuário não encontrado." };
    if (target.isMaster) return { error: "Usuários master não podem ser excluídos." };
    if (str(fd, "confirm") !== target.name) return { error: "Digite o nome exato do usuário para confirmar." };

    await db.transaction(async (tx) => {
      // Anula as referências históricas: os registros ficam sem autor (histórico preservado).
      await tx.update(schema.contacts).set({ createdBy: null }).where(eq(schema.contacts.createdBy, userId));
      await tx.update(schema.dealStageHistory).set({ changedBy: null }).where(eq(schema.dealStageHistory.changedBy, userId));
      await tx.update(schema.receivables).set({ createdBy: null }).where(eq(schema.receivables.createdBy, userId));
      await tx.update(schema.quotes).set({ createdBy: null }).where(eq(schema.quotes.createdBy, userId));
      await tx.update(schema.appointments).set({ createdBy: null }).where(eq(schema.appointments.createdBy, userId));
      await tx.update(schema.tasks).set({ createdBy: null }).where(eq(schema.tasks.createdBy, userId));
      await tx.update(schema.messages).set({ senderUserId: null }).where(eq(schema.messages.senderUserId, userId));
      await tx.update(schema.activities).set({ actorId: null }).where(eq(schema.activities.actorId, userId));
      await tx.update(schema.auditLogs).set({ userId: null }).where(eq(schema.auditLogs.userId, userId));

      // Anula as referências aos vínculos (company_members) do usuário antes de removê-los.
      const members = await tx
        .select({ id: schema.companyMembers.id })
        .from(schema.companyMembers)
        .where(eq(schema.companyMembers.userId, userId));
      const memberIds = members.map((m) => m.id);
      if (memberIds.length) {
        await tx.update(schema.contacts).set({ ownerId: null }).where(inArray(schema.contacts.ownerId, memberIds));
        await tx.update(schema.deals).set({ ownerId: null }).where(inArray(schema.deals.ownerId, memberIds));
        await tx.update(schema.orders).set({ sellerId: null }).where(inArray(schema.orders.sellerId, memberIds));
        await tx.update(schema.quotes).set({ sellerId: null }).where(inArray(schema.quotes.sellerId, memberIds));
        await tx.update(schema.appointments).set({ professionalId: null }).where(inArray(schema.appointments.professionalId, memberIds));
        await tx.update(schema.conversations).set({ assignedTo: null }).where(inArray(schema.conversations.assignedTo, memberIds));
        await tx.update(schema.whatsappAccounts).set({ defaultOwnerId: null }).where(inArray(schema.whatsappAccounts.defaultOwnerId, memberIds));
        await tx.update(schema.goals).set({ memberId: null }).where(inArray(schema.goals.memberId, memberIds));
        // tasks.assigned_to é NOT NULL → remove as tarefas atribuídas ao usuário.
        await tx.delete(schema.tasks).where(inArray(schema.tasks.assignedTo, memberIds));
      }

      // Remove o que depende obrigatoriamente do usuário.
      await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
      await tx.delete(schema.companyMembers).where(eq(schema.companyMembers.userId, userId));
      await tx.delete(schema.users).where(eq(schema.users.id, userId));
    });
    // Audit após o commit, sem referenciar o usuário excluído.
    await audit(db, { userId: user.id, action: "user.delete", entity: "user", metadata: { id: userId, name: target.name, email: target.email } });
    revalidatePath("/master/usuarios");
    revalidatePath("/master/empresas");
    return { ok: true };
  });
}

// ───────────── Agenda de pagamentos por venda (informativa) ─────────────

/** Monta "AAAA-MM-DD" com o dia limitado ao último dia do mês. */
function clampYmd(year: number, month0: number, day: number): string {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const dd = String(Math.min(day, last)).padStart(2, "0");
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${dd}`;
}

/** Gera a agenda de pagamentos de uma venda (empresa+serviço). Substitui os pendentes; preserva os já pagos. */
export async function generateServicePayments(companyId: string, service: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const mode = str(fd, "mode") ?? "monthly"; // monthly | installment | once
    const rows: { companyId: string; service: string; dueDate: string; valueCents: number }[] = [];

    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    if (mode === "once") {
      const dueDate = str(fd, "dueDate");
      const valueCents = parseMoney(fd.get("value"));
      if (!dueDate || !YMD.test(dueDate)) return { error: "Informe uma data de pagamento válida." };
      if (valueCents <= 0) return { error: "Informe um valor válido." };
      const [oy, om, od] = dueDate.split("-").map(Number);
      rows.push({ companyId, service, dueDate: clampYmd(oy, om - 1, od), valueCents });
    } else if (mode === "installment") {
      const total = parseMoney(fd.get("total"));
      const count = Math.floor(Number(str(fd, "count")));
      const firstDate = str(fd, "firstDate");
      if (!firstDate || !YMD.test(firstDate)) return { error: "Informe uma data válida para a 1ª parcela." };
      if (!Number.isFinite(count) || count < 1 || count > 120) return { error: "Nº de parcelas inválido (1 a 120)." };
      if (total <= 0) return { error: "Informe um valor total válido." };
      const [y, m, d] = firstDate.split("-").map(Number);
      const base = y * 12 + (m - 1);
      const each = Math.floor(total / count);
      for (let i = 0; i < count; i++) {
        const cur = base + i;
        const value = i === count - 1 ? total - each * (count - 1) : each; // resto na última parcela
        rows.push({ companyId, service, dueDate: clampYmd(Math.floor(cur / 12), cur % 12, d), valueCents: value });
      }
    } else {
      const dueDay = Math.floor(Number(str(fd, "dueDay")));
      const startDate = str(fd, "startDate");
      const valueCents = parseMoney(fd.get("value"));
      const months = Math.min(60, Math.max(1, Math.floor(Number(str(fd, "months")) || 12)));
      if (!startDate || !YMD.test(startDate)) return { error: "Informe uma data de início válida." };
      if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return { error: "Dia de vencimento inválido (1 a 31)." };
      if (valueCents <= 0) return { error: "Informe um valor válido." };
      const [y, m] = startDate.split("-").map(Number);
      const base = y * 12 + (m - 1);
      for (let i = 0; i < months; i++) {
        const cur = base + i;
        rows.push({ companyId, service, dueDate: clampYmd(Math.floor(cur / 12), cur % 12, dueDay), valueCents });
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.servicePayments)
        .where(
          and(
            eq(schema.servicePayments.companyId, companyId),
            eq(schema.servicePayments.service, service),
            eq(schema.servicePayments.status, "pending"),
          ),
        );
      // Não duplica períodos já pagos.
      const paid = await tx
        .select({ dueDate: schema.servicePayments.dueDate })
        .from(schema.servicePayments)
        .where(
          and(
            eq(schema.servicePayments.companyId, companyId),
            eq(schema.servicePayments.service, service),
            eq(schema.servicePayments.status, "paid"),
          ),
        );
      const paidSet = new Set(paid.map((p) => p.dueDate));
      const toInsert = rows.filter((r) => !paidSet.has(r.dueDate));
      if (toInsert.length) await tx.insert(schema.servicePayments).values(toInsert);
      await audit(tx, { userId: user.id, companyId, action: "payments.generate", entity: "service", metadata: { service, mode, count: toInsert.length } });
    });
    revalidatePath("/master");
    revalidatePath("/master/vendas");
    revalidatePath("/master/comandas");
    revalidatePath("/master/faturamento");
    return { ok: true };
  });
}

/** Lança um valor EXTRA (avulso) numa comanda: único, mensal ou parcelado. Não mexe nos serviços. */
export async function addExtraPayments(companyId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const note = (str(fd, "note") ?? "").trim() || "Extra";
    const mode = str(fd, "mode") ?? "once";
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const rows: { companyId: string; service: string; note: string; dueDate: string; valueCents: number }[] = [];

    if (mode === "once") {
      const dueDate = str(fd, "dueDate");
      const valueCents = parseMoney(fd.get("value"));
      if (!dueDate || !YMD.test(dueDate)) return { error: "Informe uma data válida." };
      if (valueCents <= 0) return { error: "Informe um valor válido." };
      const [y, m, d] = dueDate.split("-").map(Number);
      rows.push({ companyId, service: "extra", note, dueDate: clampYmd(y, m - 1, d), valueCents });
    } else if (mode === "installment") {
      const total = parseMoney(fd.get("total"));
      const count = Math.floor(Number(str(fd, "count")));
      const firstDate = str(fd, "firstDate");
      if (!firstDate || !YMD.test(firstDate)) return { error: "Informe uma data válida para a 1ª parcela." };
      if (!Number.isFinite(count) || count < 1 || count > 120) return { error: "Nº de parcelas inválido (1 a 120)." };
      if (total <= 0) return { error: "Informe um valor total válido." };
      const [y, m, d] = firstDate.split("-").map(Number);
      const base = y * 12 + (m - 1);
      const each = Math.floor(total / count);
      for (let i = 0; i < count; i++) {
        const cur = base + i;
        const value = i === count - 1 ? total - each * (count - 1) : each;
        rows.push({ companyId, service: "extra", note, dueDate: clampYmd(Math.floor(cur / 12), cur % 12, d), valueCents: value });
      }
    } else {
      const valueCents = parseMoney(fd.get("value"));
      const dueDay = Math.floor(Number(str(fd, "dueDay")));
      const startDate = str(fd, "startDate");
      const months = Math.min(60, Math.max(1, Math.floor(Number(str(fd, "months")) || 12)));
      if (!startDate || !YMD.test(startDate)) return { error: "Informe uma data de início válida." };
      if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return { error: "Dia de vencimento inválido (1 a 31)." };
      if (valueCents <= 0) return { error: "Informe um valor válido." };
      const [y, m] = startDate.split("-").map(Number);
      const base = y * 12 + (m - 1);
      for (let i = 0; i < months; i++) {
        const cur = base + i;
        rows.push({ companyId, service: "extra", note, dueDate: clampYmd(Math.floor(cur / 12), cur % 12, dueDay), valueCents });
      }
    }

    await db.insert(schema.servicePayments).values(rows);
    await audit(db, { userId: user.id, companyId, action: "payments.extra", entity: "service", metadata: { note, mode, count: rows.length } });
    revalidatePath("/master");
    revalidatePath("/master/vendas");
    revalidatePath("/master/comandas");
    revalidatePath("/master/faturamento");
    return { ok: true };
  });
}

/** Edita o valor de um lançamento (parcela). */
export async function setPaymentValue(paymentId: string, valueCents: number) {
  const { user } = await requireMaster();
  const v = Math.max(0, Math.floor(Number(valueCents) || 0));
  await db.update(schema.servicePayments).set({ valueCents: v }).where(eq(schema.servicePayments.id, paymentId));
  await audit(db, { userId: user.id, action: "payment.value", entity: "payment", entityId: paymentId, metadata: { valueCents: v } });
  revalidatePath("/master");
  revalidatePath("/master/vendas");
  revalidatePath("/master/comandas");
  revalidatePath("/master/faturamento");
}

/** Exclui um lançamento (pagamento). */
export async function deletePayment(paymentId: string) {
  const { user } = await requireMaster();
  await db.delete(schema.servicePayments).where(eq(schema.servicePayments.id, paymentId));
  await audit(db, { userId: user.id, action: "payment.delete", entity: "payment", entityId: paymentId });
  revalidatePath("/master");
  revalidatePath("/master/vendas");
  revalidatePath("/master/comandas");
  revalidatePath("/master/faturamento");
}

/** Define o nº de parcelas de um serviço e regenera a agenda (preserva os pagos). */
export async function setServiceInstallments(companyId: string, service: string, count: number) {
  return safe(async () => {
    const { user } = await requireMaster();
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > 120) return { error: "Nº de parcelas inválido (1 a 120)." };
    await db.transaction(async (tx) => {
      await tx
        .update(schema.companyServices)
        .set({ installments: n, updatedAt: new Date() })
        .where(and(eq(schema.companyServices.companyId, companyId), eq(schema.companyServices.service, service)));
      const services = await tx
        .select({
          service: schema.companyServices.service,
          valueCents: schema.companyServices.valueCents,
          billing: schema.companyServices.billing,
          installments: schema.companyServices.installments,
        })
        .from(schema.companyServices)
        .where(eq(schema.companyServices.companyId, companyId));
      await ensureScheduleForServices(tx, companyId, services);
      await audit(tx, { userId: user.id, companyId, action: "service.installments", entity: "service", metadata: { service, installments: n } });
    });
    revalidatePath("/master");
    revalidatePath("/master/vendas");
    revalidatePath("/master/comandas");
    revalidatePath("/master/faturamento");
    return { ok: true };
  });
}

/** Alterna o status de um pagamento (lançamento). */
export async function setPaymentStatus(paymentId: string, status: "paid" | "pending") {
  const { user } = await requireMaster();
  if (status !== "paid" && status !== "pending") return;
  await db
    .update(schema.servicePayments)
    .set({ status, paidAt: status === "paid" ? new Date() : null })
    .where(eq(schema.servicePayments.id, paymentId));
  await audit(db, { userId: user.id, action: `payment.${status}`, entity: "payment", entityId: paymentId });
  revalidatePath("/master");
  revalidatePath("/master/vendas");
  revalidatePath("/master/comandas");
  revalidatePath("/master/faturamento");
}
