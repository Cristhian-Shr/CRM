import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const companyRef = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

// ───────────── Plataforma e acesso ─────────────

export type CompanySettings = {
  collaboratorsSeeAllLeads?: boolean;
  maxDiscountPercent?: number;
};

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  legalName: text("legal_name"),
  cnpj: text("cnpj"),
  phone: text("phone"),
  email: text("email"),
  logoUrl: text("logo_url"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  plan: text("plan").notNull().default("basic"),
  paymentMethod: text("payment_method"), // pix | boleto | card | transfer | cash (forma de pagamento da comanda)
  status: text("status").notNull().default("active"), // active | suspended | cancelled
  settings: jsonb("settings").$type<CompanySettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  phone: text("phone"),
  isMaster: boolean("is_master").notNull().default(false),
  status: text("status").notNull().default("active"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const companyMembers = pgTable(
  "company_members",
  {
    id: id(),
    companyId: companyRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(), // admin | collaborator
    isSeller: boolean("is_seller").notNull().default(true),
    isProfessional: boolean("is_professional").notNull().default(false),
    jobTitle: text("job_title"),
    color: text("color"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("company_members_uq").on(t.companyId, t.userId)],
);

// Serviços que a agência vende a cada empresa (valor e tipo de cobrança).
export const companyServices = pgTable(
  "company_services",
  {
    id: id(),
    companyId: companyRef(),
    service: text("service").notNull(), // development | paid_traffic | automation
    valueCents: integer("value_cents").notNull().default(0),
    billing: text("billing").notNull().default("monthly"), // monthly | quarterly | semiannual | annual | one_time
    installments: integer("installments").notNull().default(12), // nº de parcelas da recorrência (ignorado em one_time)
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_services_uq").on(t.companyId, t.service)],
);

// Agenda de pagamentos de cada venda (empresa + serviço) — FONTE ÚNICA do financeiro.
export const servicePayments = pgTable(
  "service_payments",
  {
    id: id(),
    companyId: companyRef(),
    service: text("service").notNull(), // development | paid_traffic | automation | crm | extra
    note: text("note"), // descrição, usado em lançamentos "extra"
    dueDate: date("due_date").notNull(),
    valueCents: integer("value_cents").notNull().default(0),
    status: text("status").notNull().default("pending"), // pending | paid
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [index("service_payments_company_service_idx").on(t.companyId, t.service, t.dueDate)],
);

// ───────────── Funil, origens e leads ─────────────

export const pipelineStages = pgTable("pipeline_stages", {
  id: id(),
  companyId: companyRef(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  color: text("color").notNull(),
  kind: text("kind").notNull().default("open"), // open | won | lost
  createdAt: createdAt(),
});

export const leadSources = pgTable("lead_sources", {
  id: id(),
  companyId: companyRef(),
  name: text("name").notNull(),
  type: text("type").notNull().default("other"),
  active: boolean("active").notNull().default(true),
});

export const lossReasons = pgTable("loss_reasons", {
  id: id(),
  companyId: companyRef(),
  name: text("name").notNull(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    companyId: companyRef(),
    name: text("name").notNull(),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    companyName: text("company_name"),
    cpf: text("cpf"),
    birthDate: date("birth_date"),
    gender: text("gender"),
    address: jsonb("address"),
    status: text("status").notNull().default("lead"), // lead | client | inactive
    ownerId: uuid("owner_id").references(() => companyMembers.id),
    sourceId: uuid("source_id").references(() => leadSources.id),
    metaLeadId: text("meta_lead_id"),
    metaCampaignId: text("meta_campaign_id"),
    metaAdsetId: text("meta_adset_id"),
    metaAdId: text("meta_ad_id"),
    utm: jsonb("utm"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    consentAt: ts("consent_at"),
    lastInteractionAt: ts("last_interaction_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("contacts_company_phone_uq")
      .on(t.companyId, t.phone)
      .where(sql`deleted_at is null`),
    index("contacts_company_owner_idx").on(t.companyId, t.ownerId),
  ],
);

export const deals = pgTable(
  "deals",
  {
    id: id(),
    companyId: companyRef(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    ownerId: uuid("owner_id").references(() => companyMembers.id),
    title: text("title").notNull(),
    valueCents: integer("value_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    expectedCloseDate: date("expected_close_date"),
    stageEnteredAt: ts("stage_entered_at").notNull().defaultNow(),
    wonAt: ts("won_at"),
    lostAt: ts("lost_at"),
    lossReasonId: uuid("loss_reason_id").references(() => lossReasons.id),
    lossNote: text("loss_note"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("deals_company_stage_idx").on(t.companyId, t.stageId, t.position)],
);

export const dealStageHistory = pgTable("deal_stage_history", {
  id: id(),
  companyId: companyRef(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deals.id),
  fromStage: uuid("from_stage").references(() => pipelineStages.id),
  toStage: uuid("to_stage")
    .notNull()
    .references(() => pipelineStages.id),
  changedBy: uuid("changed_by").references(() => users.id),
  changedAt: ts("changed_at").notNull().defaultNow(),
});

// ───────────── Procedimentos, programas e comanda ─────────────

export const procedures = pgTable("procedures", {
  id: id(),
  companyId: companyRef(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const programs = pgTable("programs", {
  id: id(),
  companyId: companyRef(),
  name: text("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  validityDays: integer("validity_days"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const programItems = pgTable("program_items", {
  id: id(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id, { onDelete: "cascade" }),
  procedureId: uuid("procedure_id")
    .notNull()
    .references(() => procedures.id),
  sessions: integer("sessions").notNull().default(1),
});

export const orders = pgTable("orders", {
  id: id(),
  companyId: companyRef(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  dealId: uuid("deal_id").references(() => deals.id),
  sellerId: uuid("seller_id").references(() => companyMembers.id),
  status: text("status").notNull().default("draft"), // draft | confirmed | paid | cancelled
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  paymentMethod: text("payment_method"),
  installments: integer("installments"),
  notes: text("notes"),
  confirmedAt: ts("confirmed_at"),
  createdAt: createdAt(),
});

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // procedure | program
  procedureId: uuid("procedure_id").references(() => procedures.id),
  programId: uuid("program_id").references(() => programs.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
});

export const contractedSessions = pgTable("contracted_sessions", {
  id: id(),
  companyId: companyRef(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  orderItemId: uuid("order_item_id")
    .notNull()
    .references(() => orderItems.id),
  procedureId: uuid("procedure_id")
    .notNull()
    .references(() => procedures.id),
  programId: uuid("program_id").references(() => programs.id),
  sessionsTotal: integer("sessions_total").notNull(),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  expiresAt: date("expires_at"),
});

// Contas a receber (parcelas) — originadas de comandas ou lançadas manualmente.
export const receivables = pgTable(
  "receivables",
  {
    id: id(),
    companyId: companyRef(),
    orderId: uuid("order_id").references(() => orders.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDate: date("due_date").notNull(),
    status: text("status").notNull().default("pending"), // pending | paid | canceled
    paidAt: ts("paid_at"),
    paymentMethod: text("payment_method"),
    installmentNo: integer("installment_no"),
    installmentsTotal: integer("installments_total"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("receivables_company_due_idx").on(t.companyId, t.dueDate, t.status)],
);

// Orçamentos (propostas) — podem virar comanda.
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    companyId: companyRef(),
    number: integer("number").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    sellerId: uuid("seller_id").references(() => companyMembers.id),
    status: text("status").notNull().default("open"), // open | approved | rejected | converted
    validUntil: date("valid_until"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    entryCents: integer("entry_cents").notNull().default(0),
    paymentMethod: text("payment_method"),
    installments: integer("installments"),
    notes: text("notes"),
    orderId: uuid("order_id").references(() => orders.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("quotes_company_idx").on(t.companyId, t.createdAt)],
);

export const quoteItems = pgTable("quote_items", {
  id: id(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // procedure | program
  procedureId: uuid("procedure_id").references(() => procedures.id),
  programId: uuid("program_id").references(() => programs.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
});

// ───────────── Agenda ─────────────

export const rooms = pgTable("rooms", {
  id: id(),
  companyId: companyRef(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    companyId: companyRef(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    dealId: uuid("deal_id").references(() => deals.id),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    contractedSessionId: uuid("contracted_session_id").references(() => contractedSessions.id),
    professionalId: uuid("professional_id").references(() => companyMembers.id),
    roomId: uuid("room_id").references(() => rooms.id),
    type: text("type").notNull().default("procedure"), // evaluation | procedure | return
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: text("status").notNull().default("scheduled"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("appointments_company_time_idx").on(t.companyId, t.startsAt)],
);

// ───────────── Tarefas e notificações ─────────────

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    companyId: companyRef(),
    contactId: uuid("contact_id").references(() => contacts.id),
    dealId: uuid("deal_id").references(() => deals.id),
    assignedTo: uuid("assigned_to")
      .notNull()
      .references(() => companyMembers.id),
    createdBy: uuid("created_by").references(() => users.id),
    type: text("type").notNull().default("follow_up"),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: ts("due_at").notNull(),
    remindAt: ts("remind_at"),
    remindedAt: ts("reminded_at"),
    status: text("status").notNull().default("pending"), // pending | done | cancelled
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_due_idx").on(t.companyId, t.assignedTo, t.status, t.dueAt)],
);

export const notifications = pgTable("notifications", {
  id: id(),
  companyId: companyRef(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: ts("read_at"),
  createdAt: createdAt(),
});

// ───────────── Conversas e linha do tempo ─────────────

export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: id(),
  companyId: companyRef(),
  provider: text("provider").notNull().default("meta_cloud"),
  displayPhone: text("display_phone").notNull(),
  phoneNumberId: text("phone_number_id").unique(),
  wabaId: text("waba_id"),
  accessTokenEnc: text("access_token_enc"),
  status: text("status").notNull().default("pending"),
  defaultOwnerId: uuid("default_owner_id").references(() => companyMembers.id),
  settings: jsonb("settings").notNull().default({}),
  createdAt: createdAt(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  companyId: companyRef(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  channel: text("channel").notNull().default("whatsapp"),
  whatsappAccountId: uuid("whatsapp_account_id").references(() => whatsappAccounts.id),
  assignedTo: uuid("assigned_to").references(() => companyMembers.id),
  lastMessageAt: ts("last_message_at"),
  lastInboundAt: ts("last_inbound_at"),
  unreadCount: integer("unread_count").notNull().default(0),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  createdAt: createdAt(),
});

export const messages = pgTable(
  "messages",
  {
    id: id(),
    companyId: companyRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    direction: text("direction").notNull(), // inbound | outbound
    senderType: text("sender_type").notNull(), // contact | user | ai | system
    senderUserId: uuid("sender_user_id").references(() => users.id),
    type: text("type").notNull().default("text"),
    body: text("body"),
    mediaUrl: text("media_url"),
    externalId: text("external_id"),
    status: text("status"),
    sentAt: ts("sent_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_external_uq")
      .on(t.companyId, t.externalId)
      .where(sql`external_id is not null`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    companyId: companyRef(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    dealId: uuid("deal_id").references(() => deals.id),
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("activities_contact_idx").on(t.companyId, t.contactId, t.createdAt)],
);

// ───────────── Meta Ads ─────────────

export const metaConnections = pgTable(
  "meta_connections",
  {
    id: id(),
    companyId: companyRef(),
    adAccountId: text("ad_account_id").notNull(),
    pageId: text("page_id"),
    accessTokenEnc: text("access_token_enc").notNull(),
    tokenExpiresAt: ts("token_expires_at"),
    status: text("status").notNull().default("connected"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("meta_connections_uq").on(t.companyId, t.adAccountId)],
);

export const metaCampaigns = pgTable(
  "meta_campaigns",
  {
    id: id(),
    companyId: companyRef(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id),
    metaCampaignId: text("meta_campaign_id").notNull(),
    name: text("name").notNull(),
    objective: text("objective"),
    status: text("status"),
    dailyBudgetCents: integer("daily_budget_cents"),
    lifetimeBudgetCents: integer("lifetime_budget_cents"),
    startTime: ts("start_time"),
    stopTime: ts("stop_time"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meta_campaigns_uq").on(t.companyId, t.metaCampaignId)],
);

export const metaInsightsDaily = pgTable(
  "meta_insights_daily",
  {
    id: id(),
    companyId: companyRef(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    date: date("date").notNull(),
    spendCents: integer("spend_cents").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    messagesStarted: integer("messages_started").notNull().default(0),
  },
  (t) => [uniqueIndex("meta_insights_uq").on(t.companyId, t.metaCampaignId, t.date)],
);

// ───────────── Metas e auditoria ─────────────

export const goals = pgTable("goals", {
  id: id(),
  companyId: companyRef(),
  memberId: uuid("member_id").references(() => companyMembers.id),
  metric: text("metric").notNull(), // revenue | deals_won | appointments | leads
  period: text("period").notNull().default("monthly"),
  target: integer("target").notNull(),
  startsOn: date("starts_on").notNull(),
  createdAt: createdAt(),
});

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  companyId: uuid("company_id").references(() => companies.id),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  ip: text("ip"),
  createdAt: createdAt(),
});
