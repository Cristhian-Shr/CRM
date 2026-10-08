# CRM Estética

CRM multiempresa para clínicas de estética. Next.js 15 (App Router) + React + TypeScript + Tailwind CSS, banco Neon Postgres com Drizzle ORM, sistema monolito.

## O que já funciona

| Módulo | Rota | Destaques |
|---|---|---|
| Login por empresa | `/login`, `/selecionar-empresa` | Senha com bcrypt, bloqueio após 5 tentativas, quem tem várias clínicas escolhe uma |
| Área master | `/master` | Cadastrar clínica com o primeiro admin, suspender/reativar, "entrar como empresa" (vai para a auditoria), usuários, auditoria |
| Visão Geral | `/dashboard` | Leads novos, vendas fechadas, faturamento, valor em aberto, agendamentos (conta quando entra na agenda), parados 3d+, no-show, perdidos, meta de faturamento, faturamento por vendedora, follow-ups de hoje. Comparação com o mês anterior |
| Funil de Vendas | `/funil` | Kanban arrastável com as 6 etapas padrão. Ganho vira cliente e oferece montar a comanda; Perdido pede o motivo. Alerta "sem follow-up" e dias parado |
| Leads / Clientes | `/clientes` | Busca por nome, telefone ou e-mail, filtros por status e origem. Colaborador vê só os seus (o admin pode liberar todos) |
| Ficha do cliente | `/clientes/[id]` | Dados, oportunidades, conversa estilo WhatsApp (com nota interna), linha do tempo, comanda com programa ou procedimentos, saldo de sessões, agendamentos e tarefas |
| Agenda | `/agenda` | Dia por sala ou por profissional, e lista. Cores por status, clique no horário vazio para agendar, bloqueio de conflito, uso do saldo do programa (desconta ao marcar "Atendido") |
| Tarefas | `/tarefas` | Follow-ups com data, hora e lembrete (sino de notificações) |
| Conversas | `/conversas` | Caixa de entrada do WhatsApp |
| Procedimentos e Programas | `/catalogo` | Procedimentos (nome, valor, duração) e programas montados com procedimentos e número de sessões |
| Campanhas Meta | `/campanhas` | Investimento, cliques, leads, CPL e o cruzamento com o CRM: quantos agendaram, fecharam, faturamento e ROAS |
| Relatórios | `/relatorios` | Faturamento 6 meses, funil, leads por origem, motivos de perda, procedimentos mais feitos |
| Configurações | `/configuracoes` | Dados da clínica, etapas do funil, origens, motivos de perda, salas, metas, equipe e integrações |
| Webhooks | `/api/webhooks/whatsapp`, `/api/webhooks/meta-leads` | Mensagem nova cria o lead e a conversa; formulário da Meta cria o lead com a campanha |
| Rotinas | `/api/cron/reminders`, `/api/cron/meta-sync` | Lembretes a cada 5 min e sincronização da Meta a cada 3 h (`vercel.json`) |

## Como rodar

1. Crie um projeto no [Neon](https://neon.tech) e copie a connection string (modo *pooled*).
2. Copie `.env.example` para `.env.local` e preencha. Nunca coloque essas chaves no Git.
   - `AUTH_SECRET` e `ENCRYPTION_KEY`: gere com `openssl rand -base64 32`.
3. Instale e prepare o banco:

```bash
npm install
npm run db:migrate                     # cria as tabelas no Neon
MASTER_EMAIL=voce@agencia.com MASTER_PASSWORD='senha-forte' npm run db:seed
# opcional: DEMO=1 no mesmo comando cria a "Clínica Demo" com dados de exemplo
npm run dev                            # http://localhost:3000
```

Na Clínica Demo os acessos são `admin@demo.com`, `vendas@demo.com` e `carla@demo.com`, todos com a senha `demo12345`.

## Deploy na Vercel

1. Importe o repositório na Vercel e cadastre as mesmas variáveis de ambiente.
2. Rode `npm run db:migrate` apontando para o Neon de produção (uma vez, e a cada migração nova).
3. As rotinas do `vercel.json` precisam do plano Pro para rodar a cada 5 minutos. No plano Hobby, troque por um agendador externo (ex.: cron-job.org) chamando a URL com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

## WhatsApp (Cloud API oficial)

Em Configurações → Integrações o admin da clínica cola o Phone Number ID, o WABA ID e o token. No painel da Meta, o webhook aponta para `https://SEU-DOMINIO/api/webhooks/whatsapp`, com o token de verificação igual a `WHATSAPP_VERIFY_TOKEN`, assinando o campo `messages`. As requisições são validadas com `META_APP_SECRET`.

Fora da janela de 24h da última mensagem do cliente, a Meta só aceita modelos aprovados; o CRM avisa e não envia texto livre nesse caso.

## Meta Ads

Em Configurações → Integrações cole o ID da conta (`act_...`) e um token de System User com `ads_read` e `leads_retrieval`. Para formulários (Lead Ads), informe o ID da página e assine `leadgen` apontando para `/api/webhooks/meta-leads`.

## Estrutura

```
src/
  app/(auth)        login e seleção de empresa
  app/(app)         telas da clínica (menu lateral)
  app/(master)      área do admin master
  app/api           webhooks e rotinas
  components/       UI, formulários, agenda, ficha
  lib/auth.ts       sessão (JWT em cookie httpOnly) e getContext()
  lib/db/schema.ts  tabelas (espelho da especificação)
  lib/db/tenant.ts  consultas sempre filtradas pela empresa ativa
  lib/permissions.ts
  server/actions/   Server Actions por módulo
drizzle/            migrações SQL
scripts/            migrate e seed
```

Toda tabela da clínica tem `company_id`, e a empresa ativa vem sempre da sessão. Dinheiro fica em centavos; datas em `timestamptz`, exibidas no fuso de São Paulo.

Diferenças em relação à especificação: a sessão usa JWT próprio (biblioteca `jose`) em vez do Auth.js, com os mesmos campos (`userId`, `isMaster`, `activeCompanyId`), e os componentes de tela são feitos direto em Tailwind em vez do shadcn/ui.

## Próximos passos sugeridos

Convite de equipe por e-mail, envio de modelos do WhatsApp fora das 24h, upload de mídia, atendente automático (IA), detecção de duplicados, importação de CSV e Row Level Security no Postgres como segunda barreira.
