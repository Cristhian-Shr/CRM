# CRM para Clínicas de Estética: Especificação de Arquitetura e Banco de Dados

Versão 1.0, 07/10/2026. Documento base para as threads de construção (base do sistema, ficha do cliente/programas/agenda e integrações).

Referência visual: prints do CRM Magrass (Lovable/Supabase) enviados em 07/10/2026. A ideia é manter a mesma linguagem visual (menu lateral claro, cor de destaque rosada, cards arredondados) e reaproveitar o que funciona lá: funil arrastável, cards de indicadores com comparação ao mês anterior, tabela de faturamento por vendedora, origens dos leads, IA/atendente no WhatsApp e agenda por sala.

---

## 1. Visão geral

| Item | Decisão |
|---|---|
| Tipo | SaaS multiempresa (multi-tenant), um único sistema monolito |
| Front + back | Next.js 15 (App Router) + React + TypeScript + Tailwind CSS |
| UI | shadcn/ui (componentes sobre Tailwind) + lucide-react (ícones) + dnd-kit (arrastar no kanban) + Recharts (gráficos) |
| Banco | Neon Postgres (driver `@neondatabase/serverless`) |
| ORM / migrações | Drizzle ORM + drizzle-kit |
| Autenticação | Auth.js (NextAuth v5) com login por e-mail e senha (bcrypt), sessão em JWT com `userId`, `isMaster` e `activeCompanyId` |
| Validação | Zod em todas as Server Actions e rotas de API |
| Tarefas agendadas | Vercel Cron chamando rotas `/api/cron/*` (lembretes, sync da Meta) |
| Arquivos (fotos, mídias do WhatsApp) | Vercel Blob ou Cloudflare R2 |
| Hospedagem | Vercel (app) + Neon (banco), região São Paulo quando disponível |

Por que monolito: um só repositório e um só deploy. Telas, regras de negócio, webhooks e rotinas agendadas ficam no mesmo projeto Next.js. Isso é mais barato e mais simples de manter para o tamanho atual.

---

## 2. Multiempresa e níveis de acesso

### 2.1 Os três níveis

| Nível | Quem é | O que faz |
|---|---|---|
| **Admin master** | Você (Vela) | Cadastra e suspende empresas (clínicas), cria o primeiro admin de cada uma, vê indicadores de todas, pode "entrar como" uma empresa para dar suporte |
| **Admin da empresa** | Dono ou gestor da clínica | Gerencia equipe, procedimentos, programas, etapas do funil, origens, integrações (WhatsApp e Meta), metas; vê todos os leads e relatórios da clínica |
| **Colaborador** | Vendedora, recepcionista, profissional | Trabalha leads, tarefas, agenda e conversas. Por padrão vê só os leads em que é responsável (configurável pelo admin) |

Um mesmo usuário pode participar de mais de uma empresa (ex.: profissional que atende em duas clínicas). Por isso o papel fica no vínculo usuário-empresa, não no usuário.

### 2.2 Como o isolamento funciona

1. **Toda tabela de dados da clínica tem `company_id`.** Não existe consulta sem esse filtro.
2. **A empresa ativa vem da sessão**, nunca de um parâmetro que o navegador manda. No login, se o usuário tem uma empresa, ela vira a ativa; se tem várias, ele escolhe numa tela de seleção.
3. **Camada única de acesso a dados.** Todas as consultas passam por funções em `lib/db/tenant.ts` que recebem o contexto (`ctx = { userId, companyId, role }`) e aplicam `where company_id = ctx.companyId` automaticamente.
4. **Segunda barreira no banco (recomendado):** Row Level Security do Postgres. Cada transação faz `set local app.company_id = '...'` e as políticas bloqueiam linhas de outra empresa, mesmo se alguém esquecer um filtro no código.
5. **Master** acessa a área `/master` e, para dar suporte, usa "entrar como empresa": a sessão ganha `activeCompanyId` daquela clínica e tudo fica registrado no log de auditoria.

Endereço: um único domínio (ex.: `app.seucrm.com.br`). A empresa é definida pela sessão, sem subdomínios por enquanto. Subdomínio por clínica pode vir depois sem mudar o banco.

### 2.3 Matriz de permissões

| Ação | Master | Admin | Colaborador |
|---|:-:|:-:|:-:|
| Cadastrar / suspender empresas | ✓ | | |
| Gerenciar equipe da clínica | ✓ | ✓ | |
| Configurar etapas do funil, origens, motivos de perda | ✓ | ✓ | |
| Cadastrar procedimentos e programas | ✓ | ✓ | |
| Conectar WhatsApp e Meta Ads | ✓ | ✓ | |
| Ver todos os leads da clínica | ✓ | ✓ | só os seus (ou todos, se o admin liberar) |
| Criar / editar leads e mover no funil | ✓ | ✓ | ✓ |
| Excluir leads | ✓ | ✓ | |
| Montar comanda / vender programa | ✓ | ✓ | ✓ |
| Dar desconto acima do limite | ✓ | ✓ | |
| Agenda (marcar, remarcar, confirmar) | ✓ | ✓ | ✓ |
| Tarefas e lembretes | ✓ | ✓ | ✓ (as suas e as que criar) |
| Dashboard e relatórios da clínica | ✓ | ✓ | só os próprios números |
| Campanhas da Meta | ✓ | ✓ | |
| Exportar CSV | ✓ | ✓ | |

A permissão "colaborador vê todos os leads" é um campo em `companies.settings` (`collaboratorsSeeAllLeads`).

---

## 3. Menu lateral e módulos

Menu fixo à esquerda, recolhível no celular, com logo da clínica no topo e usuário logado no rodapé (como no Magrass).

**Menu da clínica (admin e colaborador):**

| Item | Rota | Quem vê |
|---|---|---|
| Visão Geral (Dashboard) | `/dashboard` | todos |
| Funil de Vendas (Kanban) | `/funil` | todos |
| Leads / Clientes | `/clientes` | todos |
| Agenda | `/agenda` | todos |
| Tarefas | `/tarefas` | todos |
| Conversas (WhatsApp) | `/conversas` | todos |
| Procedimentos e Programas | `/catalogo` | admin (colaborador só consulta) |
| Campanhas Meta | `/campanhas` | admin |
| Relatórios | `/relatorios` | admin |
| Equipe | `/configuracoes/equipe` | admin |
| Configurações (funil, origens, integrações, metas) | `/configuracoes` | admin |

**Menu do master** (área `/master`): Empresas, Usuários, Planos, Auditoria, e um seletor "Entrar como empresa".

Sino de notificações no topo direito (lembretes de tarefa, lead novo, mensagem nova).

---

## 4. Estrutura de dados

Convenções:
- IDs `uuid` (`gen_random_uuid()`).
- Dinheiro em centavos, tipo `integer` (`value_cents`). Evita erro de arredondamento.
- Datas `timestamptz`, exibidas no fuso da clínica (`America/Sao_Paulo` por padrão).
- Exclusão "suave" (`deleted_at`) em clientes e oportunidades, por causa de histórico e LGPD.
- Telefones gravados no formato internacional (`+5551996171234`), que é o formato do WhatsApp.

### 4.1 Mapa das tabelas

```
companies ──< company_members >── users
    │
    ├──< pipeline_stages        ├──< lead_sources        ├──< loss_reasons
    ├──< contacts ──< deals ──< deal_stage_history
    │       │           └──< orders ──< order_items
    │       ├──< contracted_sessions (saldo de sessões do programa)
    │       ├──< appointments >── rooms / procedures / company_members (profissional)
    │       ├──< tasks
    │       ├──< activities (linha do tempo)
    │       └──< conversations ──< messages
    ├──< procedures ──< program_items >── programs
    ├──< whatsapp_accounts
    ├──< meta_connections ──< meta_campaigns ──< meta_insights_daily
    ├──< goals
    ├──< notifications
    └──< audit_logs
```

Decisão importante: **cliente e oportunidade são tabelas separadas.**
- `contacts` é a pessoa (a ficha do cliente).
- `deals` é cada negociação, o card do kanban.

Assim uma cliente que já fechou um programa pode voltar meses depois e abrir uma nova oportunidade sem perder o histórico, e o "valor em aberto" do dashboard soma negociações, não pessoas. Quando um lead novo chega, o sistema cria as duas coisas juntas, então para quem usa parece um item só.

### 4.2 Plataforma e acesso

```sql
create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                -- "Clínica Magrass"
  slug          text not null unique,
  legal_name    text,
  cnpj          text,
  phone         text,
  email         text,
  logo_url      text,
  timezone      text not null default 'America/Sao_Paulo',
  plan          text not null default 'basic',           -- basic | pro
  status        text not null default 'active',          -- active | suspended | cancelled
  settings      jsonb not null default '{}',             -- collaboratorsSeeAllLeads, maxDiscountPercent, businessHours...
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table users (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null unique,
  password_hash  text not null,
  avatar_url     text,
  phone          text,
  is_master      boolean not null default false,          -- só você
  status         text not null default 'active',          -- active | disabled
  last_login_at  timestamptz,
  created_at     timestamptz not null default now()
);

create table company_members (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  user_id          uuid not null references users(id),
  role             text not null,                          -- admin | collaborator
  is_seller        boolean not null default true,          -- aparece no "faturamento por vendedora"
  is_professional  boolean not null default false,         -- aparece como coluna na agenda
  job_title        text,                                   -- "Esteticista", "Recepção"
  color            text,                                   -- cor na agenda
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (company_id, user_id)
);

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  email       text not null,
  role        text not null,
  token       text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  invited_by  uuid references users(id)
);
```

### 4.3 Funil, origens e leads

```sql
create table pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,
  position    integer not null,
  color       text not null,
  kind        text not null default 'open',   -- open | won | lost
  created_at  timestamptz not null default now()
);

create table lead_sources (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,                  -- "Instagram", "Indicação", "Passou na porta"
  type        text not null,                  -- paid_ad | organic | referral | partnership | internal_base | website | other
  active      boolean not null default true
);

create table loss_reasons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null                   -- "Preço", "Sem retorno", "Fechou com concorrente"
);

create table contacts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  name                text not null,
  phone               text,                    -- formato +55...
  whatsapp            text,                    -- se diferente do telefone
  email               text,
  company_name        text,                    -- campo "Empresa" da ficha
  cpf                 text,
  birth_date          date,
  gender              text,
  address             jsonb,
  status              text not null default 'lead',   -- lead | client | inactive
  owner_id            uuid references company_members(id),  -- responsável pelo atendimento
  source_id           uuid references lead_sources(id),
  -- rastreio de anúncio (preenchido pela integração Meta ou por UTM)
  meta_lead_id        text,
  meta_campaign_id    text,
  meta_adset_id       text,
  meta_ad_id          text,
  utm                 jsonb,
  tags                text[] not null default '{}',
  notes               text,
  consent_at          timestamptz,             -- LGPD: aceite de contato
  last_interaction_at timestamptz,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create unique index contacts_company_phone_uq on contacts(company_id, phone) where deleted_at is null;  -- evita duplicados
create index contacts_company_owner_idx on contacts(company_id, owner_id);

create table deals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  contact_id          uuid not null references contacts(id),
  stage_id            uuid not null references pipeline_stages(id),
  owner_id            uuid references company_members(id),
  title               text not null,                  -- "Programa Corpo Verão"
  value_cents         integer not null default 0,
  position            integer not null default 0,     -- ordem dentro da coluna
  expected_close_date date,
  stage_entered_at    timestamptz not null default now(),  -- para "parados há 3+ dias"
  won_at              timestamptz,
  lost_at             timestamptz,
  loss_reason_id      uuid references loss_reasons(id),
  loss_note           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index deals_company_stage_idx on deals(company_id, stage_id, position);

create table deal_stage_history (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  deal_id     uuid not null references deals(id),
  from_stage  uuid references pipeline_stages(id),
  to_stage    uuid not null references pipeline_stages(id),
  changed_by  uuid references users(id),
  changed_at  timestamptz not null default now()
);
```

**Etapas criadas automaticamente para cada empresa nova** (o admin pode renomear, reordenar e adicionar):

| Posição | Etapa | Tipo |
|---|---|---|
| 1 | Novo Lead | open |
| 2 | Em Qualificação | open |
| 3 | Aguardando Proposta | open |
| 4 | Em Negociação | open |
| 5 | Fechado / Ganho | won |
| 6 | Perdido | lost |

Regras do kanban:
- Arrastar para uma etapa `won` grava `won_at`, muda o contato para `client` e abre a tela de comanda se ainda não houver uma.
- Arrastar para `lost` pede o motivo de perda.
- Toda mudança grava em `deal_stage_history` e gera um item na linha do tempo.
- Clínicas que preferirem o fluxo do Magrass podem adicionar etapas como "Agendamento", "Consulta Realizada" e "No-show".

### 4.4 Procedimentos, programas e comanda

```sql
create table procedures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  name              text not null,                -- "Drenagem linfática"
  category          text,                         -- "Corporal", "Facial", "Injetáveis"
  description       text,
  price_cents       integer not null,             -- valor avulso
  duration_minutes  integer not null default 60,  -- usado pela agenda
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table programs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id),
  name           text not null,                   -- "Programa Corpo Verão"
  description    text,
  price_cents    integer not null,                -- valor do pacote (pode ter desconto sobre a soma)
  validity_days  integer,                         -- prazo para usar as sessões
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table program_items (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references programs(id) on delete cascade,
  procedure_id  uuid not null references procedures(id),
  sessions      integer not null default 1        -- ex.: 10 sessões de drenagem
);

-- Comanda: o que foi vendido para o cliente
create table orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  contact_id      uuid not null references contacts(id),
  deal_id         uuid references deals(id),
  seller_id       uuid references company_members(id),
  status          text not null default 'draft',   -- draft | confirmed | paid | cancelled
  subtotal_cents  integer not null default 0,
  discount_cents  integer not null default 0,
  total_cents     integer not null default 0,
  payment_method  text,                            -- pix | card | cash | installments
  installments    integer,
  notes           text,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  item_type         text not null,                 -- procedure | program
  procedure_id      uuid references procedures(id),
  program_id        uuid references programs(id),
  description       text not null,                 -- nome copiado no momento da venda
  quantity          integer not null default 1,
  unit_price_cents  integer not null,
  total_cents       integer not null
);

-- Saldo de sessões que o cliente tem para agendar
create table contracted_sessions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id),
  contact_id     uuid not null references contacts(id),
  order_item_id  uuid not null references order_items(id),
  procedure_id   uuid not null references procedures(id),
  program_id     uuid references programs(id),
  sessions_total integer not null,
  sessions_used  integer not null default 0,
  expires_at     date
);
```

Fluxo na ficha do cliente:
1. A vendedora clica em "Montar comanda", escolhe um programa pronto e/ou procedimentos avulsos, ajusta quantidade e desconto.
2. Ao confirmar a comanda, o sistema copia nomes e preços para `order_items` (assim mudar o preço do catálogo depois não altera vendas antigas), atualiza o valor da oportunidade e gera `contracted_sessions`: um programa com "10x drenagem + 5x radiofrequência" vira dois saldos, um de 10 e outro de 5.
3. Na agenda, ao marcar um atendimento para essa cliente, o sistema mostra o saldo disponível e desconta quando o atendimento é marcado como realizado.

### 4.5 Agenda

```sql
create table rooms (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,          -- "Estética 1", "Avaliação"
  active      boolean not null default true
);

create table appointments (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id),
  contact_id             uuid not null references contacts(id),
  deal_id                uuid references deals(id),
  procedure_id           uuid references procedures(id),
  contracted_session_id  uuid references contracted_sessions(id),  -- sessão do programa sendo usada
  professional_id        uuid references company_members(id),
  room_id                uuid references rooms(id),
  type                   text not null default 'procedure',   -- evaluation | procedure | return
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  status                 text not null default 'scheduled',
     -- scheduled (marcado) | confirmed | waiting (aguardando) | in_progress | done (atendido) | no_show (faltou) | cancelled (desmarcado)
  notes                  text,
  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),  -- base do contador do dashboard
  updated_at             timestamptz not null default now()
);
create index appointments_company_time_idx on appointments(company_id, starts_at);
```

Visões da agenda: por dia com colunas por sala ou por profissional (como no Agenda Magrass), semana e lista. Cores por status. Ao salvar, o sistema impede conflito de horário na mesma sala ou com o mesmo profissional.

### 4.6 Tarefas, lembretes e notificações

```sql
create table tasks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  contact_id    uuid references contacts(id),
  deal_id       uuid references deals(id),
  assigned_to   uuid not null references company_members(id),
  created_by    uuid references users(id),
  type          text not null default 'follow_up',   -- follow_up | call | whatsapp | meeting | other
  title         text not null,
  description   text,
  due_at        timestamptz not null,                 -- data e hora do follow-up
  remind_at     timestamptz,                          -- quando avisar (ex.: 15 min antes)
  reminded_at   timestamptz,                          -- preenchido quando o aviso sai
  status        text not null default 'pending',      -- pending | done | cancelled
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index tasks_due_idx on tasks(company_id, assigned_to, status, due_at);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  user_id     uuid not null references users(id),
  type        text not null,       -- task_reminder | new_lead | new_message | appointment_soon
  title       text not null,
  body        text,
  link        text,                -- ex.: /clientes/<id>
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
```

Como o lembrete dispara: uma rotina (`/api/cron/reminders`) roda a cada 5 minutos, busca tarefas com `remind_at <= agora`, `reminded_at` vazio e status `pending`, cria a notificação (sino no topo) e marca `reminded_at`. Opcional: enviar também por WhatsApp para a vendedora. Tarefas vencidas aparecem em vermelho na lista e no card do lead ("Sem follow-up" / "Follow-up atrasado", como no Magrass).

### 4.7 Ficha do cliente: conversas e linha do tempo

```sql
create table conversations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  contact_id       uuid not null references contacts(id),
  channel          text not null default 'whatsapp',   -- whatsapp | instagram | internal_note
  whatsapp_account_id uuid references whatsapp_accounts(id),
  assigned_to      uuid references company_members(id),
  last_message_at  timestamptz,
  unread_count     integer not null default 0,
  ai_enabled       boolean not null default false,     -- atendente automático ligado nesta conversa
  created_at       timestamptz not null default now()
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  conversation_id  uuid not null references conversations(id),
  direction        text not null,                -- inbound | outbound
  sender_type      text not null,                -- contact | user | ai | system
  sender_user_id   uuid references users(id),
  type             text not null default 'text', -- text | image | audio | video | document | template
  body             text,
  media_url        text,
  external_id      text,                         -- id da mensagem no WhatsApp (wamid)
  status           text,                         -- sent | delivered | read | failed
  sent_at          timestamptz not null default now()
);
create unique index messages_external_uq on messages(company_id, external_id) where external_id is not null;

-- Linha do tempo: um registro por acontecimento
create table activities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  contact_id  uuid not null references contacts(id),
  deal_id     uuid references deals(id),
  actor_id    uuid references users(id),          -- null quando é o sistema ou a IA
  type        text not null,
     -- note | call | stage_changed | owner_changed | message_in | message_out
     -- appointment_created | appointment_status | order_created | task_created | task_done | lead_created
  payload     jsonb not null default '{}',        -- detalhes (de/para, valor, texto da nota)
  created_at  timestamptz not null default now()
);
create index activities_contact_idx on activities(company_id, contact_id, created_at desc);
```

Ficha do cliente (`/clientes/[id]`), em três colunas no desktop:
- **Esquerda:** dados (nome, telefone/WhatsApp com botão de abrir conversa, e-mail, empresa, status, responsável, origem, tags) e oportunidades abertas com a etapa atual.
- **Centro:** abas "Conversa" (chat estilo WhatsApp, com envio de mensagem e notas internas) e "Linha do tempo" (tudo que aconteceu, em ordem).
- **Direita:** comanda / programa contratado com saldo de sessões, próximos agendamentos, tarefas pendentes.

### 4.8 Integrações (WhatsApp e Meta Ads)

```sql
create table whatsapp_accounts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  provider            text not null default 'meta_cloud',   -- meta_cloud | evolution | zapi
  display_phone       text not null,
  phone_number_id     text unique,             -- Meta Cloud API
  waba_id             text,
  access_token_enc    text,                    -- criptografado (AES-GCM com chave do servidor)
  status              text not null default 'pending',     -- pending | connected | error
  default_owner_id    uuid references company_members(id), -- quem recebe os leads novos
  settings            jsonb not null default '{}',         -- IA ligada, horário, lista branca...
  created_at          timestamptz not null default now()
);

create table meta_connections (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  ad_account_id      text not null,            -- act_123456
  page_id            text,                     -- página do Facebook (formulários de lead)
  access_token_enc   text not null,
  token_expires_at   timestamptz,
  status             text not null default 'connected',
  last_sync_at       timestamptz,
  unique (company_id, ad_account_id)
);

create table meta_campaigns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  connection_id     uuid not null references meta_connections(id),
  meta_campaign_id  text not null,
  name              text not null,
  objective         text,
  status            text,                     -- ACTIVE | PAUSED | ...
  daily_budget_cents    integer,
  lifetime_budget_cents integer,
  start_time        timestamptz,
  stop_time         timestamptz,
  updated_at        timestamptz not null default now(),
  unique (company_id, meta_campaign_id)
);

create table meta_insights_daily (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  meta_campaign_id  text not null,
  date              date not null,
  spend_cents       integer not null default 0,
  impressions       integer not null default 0,
  reach             integer not null default 0,
  clicks            integer not null default 0,
  leads             integer not null default 0,     -- leads segundo a Meta
  messages_started  integer not null default 0,     -- conversas iniciadas no WhatsApp
  unique (company_id, meta_campaign_id, date)
);
```

Detalhes de funcionamento na seção 6.

### 4.9 Metas, auditoria (vistas no Magrass)

```sql
create table goals (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  member_id   uuid references company_members(id),   -- null = meta da clínica
  metric      text not null,     -- revenue | deals_won | appointments | leads
  period      text not null default 'monthly',
  target      integer not null,  -- em centavos quando metric = revenue
  starts_on   date not null,
  created_at  timestamptz not null default now()
);

create table audit_logs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id),
  user_id      uuid references users(id),
  action       text not null,     -- login | impersonate | contact.delete | export.csv ...
  entity       text,
  entity_id    uuid,
  metadata     jsonb,
  ip           text,
  created_at   timestamptz not null default now()
);
```

O log de auditoria atende a LGPD (mesma faixa "acessos monitorados" que aparece no Magrass) e registra quando o master entra numa empresa.

---

## 5. Dashboard (Visão Geral)

Filtro de mês no topo (padrão: mês atual), comparação com o mês anterior em cada card, como no Magrass.

| Indicador | Regra de cálculo |
|---|---|
| Leads novos | `contacts` criados no período |
| Vendas fechadas no mês | `deals` com `won_at` no período (quantidade) |
| Faturamento do mês | soma de `orders.total_cents` confirmadas no período |
| Valor total em aberto | soma de `deals.value_cents` em etapas `open` (sem data, é o retrato de agora) |
| Agendamentos | `appointments` com `created_at` no período, ou seja, conta quando é colocado na agenda, como você pediu |
| Leads parados 3+ dias | `deals` em etapa `open` com `stage_entered_at` há mais de 3 dias |
| No-show | `appointments` com status `no_show` no período |
| Perdidos | `deals` com `lost_at` no período |
| Meta de faturamento | barra de progresso contra `goals` (quando cadastrada) |

Mais a tabela "Faturamento por vendedora" (leads, fechadas, faturado no mês, mês anterior, variação) e a lista "Meus follow-ups de hoje". Colaborador vê os mesmos cards filtrados pelos próprios números.

---

## 6. Integrações

### 6.1 Recebimento de mensagens do WhatsApp

**Recomendado: WhatsApp Cloud API oficial da Meta.** Não tem risco de bloqueio do número e conversa direto com os anúncios "clique para WhatsApp". Alternativa mais rápida de testar: Evolution API ou Z-API (conecta lendo QR Code), com risco maior de banimento. O banco já aceita os dois (`whatsapp_accounts.provider`).

Passo a passo da conexão (feito pelo admin da clínica em Configurações → Integrações):
1. Criar um app no Meta for Developers e adicionar o produto WhatsApp.
2. Registrar o número da clínica e gerar um token de usuário do sistema (System User) com permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
3. No CRM, colar `phone_number_id`, `waba_id` e o token. O CRM mostra a URL do webhook e o token de verificação.
4. No painel da Meta, em WhatsApp → Configuração → Webhook, colar a URL `https://app.seucrm.com.br/api/webhooks/whatsapp` e assinar o campo `messages`.

O que o sistema faz quando chega uma mensagem (`POST /api/webhooks/whatsapp`):
1. Confere a assinatura `X-Hub-Signature-256` com o App Secret (bloqueia requisições falsas).
2. Descobre a clínica pelo `phone_number_id`.
3. Procura o contato pelo telefone. Se não existir, cria o contato com origem "WhatsApp" (ou a campanha, quando a mensagem vem de anúncio e traz `referral.source_id`), cria a oportunidade em "Novo Lead" com o responsável padrão e avisa a equipe.
4. Cria ou reabre a conversa e grava a mensagem (sem duplicar, usando o `external_id`). Mídias são baixadas e guardadas no storage.
5. Registra na linha do tempo e atualiza `last_interaction_at`.
6. Se o atendente automático estiver ligado, gera a resposta (fase posterior, ver 6.3).

Envio de mensagens pela ficha do cliente: dentro de 24h da última mensagem do cliente pode mandar texto livre; fora disso, só modelos (templates) aprovados pela Meta. A tela avisa e oferece os modelos.

Atualizações de status (entregue, lido) chegam pelo mesmo webhook e atualizam `messages.status`.

### 6.2 Dados das campanhas da Meta

1. O admin conecta a conta de anúncios (login com Facebook pelo próprio CRM, permissão `ads_read`, ou colando um token de System User com acesso à conta `act_...`).
2. Uma rotina (`/api/cron/meta-sync`) roda a cada 3 horas para cada conexão ativa:
   - `GET /act_{id}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time` → grava em `meta_campaigns`.
   - `GET /act_{id}/insights?level=campaign&time_increment=1&date_preset=last_7d&fields=campaign_id,spend,impressions,reach,clicks,actions` → grava em `meta_insights_daily` (os últimos dias são regravados porque a Meta ajusta números depois).
3. Leads de formulário (Lead Ads): assinar o webhook `leadgen` da página. Cada lead novo vira contato com `meta_lead_id`, `meta_campaign_id`, `meta_ad_id` preenchidos, e entra em "Novo Lead".

Tela "Campanhas Meta": lista das campanhas ativas com investimento, impressões, cliques, leads da Meta e custo por lead. O diferencial é cruzar com o CRM: para cada campanha, quantos leads realmente entraram, quantos agendaram, quantos fecharam, faturamento gerado e retorno sobre o investimento (faturamento ÷ investimento).

### 6.3 Atendente automático (fase posterior)

O Magrass tem uma "IA Receptiva" que qualifica leads e passa para a vendedora. O banco já está preparado (`conversations.ai_enabled`, `messages.sender_type = 'ai'`, `whatsapp_accounts.settings`). Fica para depois da integração básica estar estável.

---

## 7. Organização do código (Next.js)

```
src/
  app/
    (auth)/login, (auth)/selecionar-empresa, (auth)/convite/[token]
    (app)/                      ← layout com menu lateral, exige empresa ativa
      dashboard/  funil/  clientes/[id]/  agenda/  tarefas/  conversas/
      catalogo/  campanhas/  relatorios/  configuracoes/{equipe,funil,origens,integracoes,metas}/
    (master)/master/            ← exige is_master
      empresas/  usuarios/  auditoria/
    api/
      auth/[...nextauth]/
      webhooks/whatsapp/        ← GET (verificação) e POST (mensagens)
      webhooks/meta-leads/
      cron/reminders/  cron/meta-sync/
  components/ (ui/ do shadcn, layout/Sidebar, kanban/, agenda/, chat/)
  lib/
    auth.ts                     ← Auth.js + helper getContext()
    db/schema/*.ts              ← tabelas Drizzle (espelho da seção 4)
    db/tenant.ts                ← consultas sempre filtradas por company_id
    permissions.ts              ← can(ctx, 'leads.delete')
    integrations/whatsapp.ts, meta.ts
    crypto.ts                   ← criptografia dos tokens
  server/actions/               ← Server Actions por módulo (leads.ts, deals.ts, agenda.ts...)
drizzle/                        ← migrações geradas
```

Variáveis de ambiente: `DATABASE_URL` (Neon), `AUTH_SECRET`, `ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`.

---

## 8. Segurança e LGPD

- Senhas com bcrypt; bloqueio após 5 tentativas erradas.
- Tokens da Meta e do WhatsApp criptografados no banco.
- Webhooks validados por assinatura; rotas de cron protegidas por `CRON_SECRET`.
- Toda Server Action chama `getContext()` e `can()` antes de tocar no banco.
- Exportação de CSV, exclusão de contato e "entrar como empresa" vão para `audit_logs`.
- Campo de consentimento (`contacts.consent_at`) e opção de anonimizar um contato a pedido do titular.

---

## 9. Ordem de construção

| Etapa | O que entrega | Thread do plano |
|---|---|---|
| 1 | Este documento | Arquitetura e banco de dados |
| 2 | Projeto Next.js, banco no Neon com as migrações, login, área master (cadastro de empresas), menu lateral, equipe, dashboard e kanban | Base do sistema |
| 3 | Ficha do cliente com chat e linha do tempo, catálogo de procedimentos e programas, comanda, saldo de sessões, agenda, tarefas com lembretes | Ficha do cliente, programas e agenda |
| 4 | Webhook do WhatsApp, envio de mensagens, conexão com a Meta, tela de campanhas, Lead Ads | Integrações |
| depois | Metas, ranking, relatórios avançados, atendente automático, detecção de duplicados, importação de CSV | a combinar |

Para as etapas 2 a 4 é preciso um repositório no GitHub conectado ao projeto e um banco criado no Neon (a `DATABASE_URL`).
