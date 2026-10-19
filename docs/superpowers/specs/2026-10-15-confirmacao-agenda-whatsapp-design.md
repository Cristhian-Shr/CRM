# Confirmação de agenda por WhatsApp — Design

**Data:** 2026-10-15
**Autor:** Cristhian S. Schröer (com Claude)

## Objetivo

Enviar automaticamente, na véspera, uma mensagem de WhatsApp pedindo confirmação
de presença para os clientes com agendamento no dia seguinte. A resposta do
cliente confirma (ou sinaliza recusa) o agendamento de forma automática.

## Decisões (brainstorming)

| Tema | Decisão |
|------|---------|
| Registro da confirmação | **Automático pela resposta** do cliente |
| Timing | **Véspera, horário fixo** (1 execução/dia) |
| Escopo dos agendamentos | **Só os ainda não confirmados** (status `scheduled`) |
| Gatilho diário | **n8n (Schedule)** chamando o endpoint (Vercel Hobby não tem cron) |
| Conteúdo da mensagem | **Template fixo + variáveis**; empresa cadastra o nome do template aprovado |
| Recusa do cliente ("NÃO/CANCELAR") | **Só notificar a equipe** (não altera status automaticamente) |
| Workflow n8n | **Apenas documentar** o passo a passo (não criar via MCP agora) |

## Contexto do que já existe

- Tabela `appointments` com `startsAt`, `status` (`scheduled`/`confirmed`/`waiting`/
  `in_progress`/`done`/`no_show`/`cancelled`), `contactId`, `professionalId`
  (`app/src/lib/db/schema.ts:385`).
- Integração WhatsApp Meta Cloud API: `sendText()` outbound e verificação de
  assinatura (`app/src/lib/integrations/whatsapp.ts`).
- `whatsappAccounts` por empresa com `accessTokenEnc`, `phoneNumberId` e
  `settings` (jsonb) (`app/src/lib/db/schema.ts:452`).
- Webhook inbound já recebe mensagens e statuses, faz upsert de lead/contato,
  cria conversa e notifica (`app/src/app/api/webhooks/whatsapp/route.ts`).
- Padrão de endpoint de cron protegido por `CRON_SECRET`
  (`app/src/app/api/cron/auth.ts`, `app/src/app/api/cron/reminders/route.ts`).
- A UI de conversas já reconhece a regra das 24h da Meta: fora da janela só
  valem templates aprovados (`app/src/server/actions/conversations.ts:46-47`).

## Restrições importantes

1. **Template obrigatório (Meta):** mensagem proativa fora da janela de 24h exige
   um **template aprovado** (HSM). O `sendText` atual (texto livre) é bloqueado
   nesse cenário. É preciso uma função `sendTemplate()`.
2. **Sem cron na Vercel (Hobby):** o disparo diário vem do n8n via HTTP, usando
   o header `Authorization: Bearer <CRON_SECRET>`.
3. **Pré-requisito do cliente:** criar e aprovar na Meta um template de
   confirmação (categoria *Utility*) com variáveis para nome/data/hora/profissional.

## Arquitetura

### 1. `sendTemplate()` — `app/src/lib/integrations/whatsapp.ts` (novo)

Envia mensagem `type: "template"` para a Cloud API:

```
POST {GRAPH}/{phoneNumberId}/messages
{
  messaging_product: "whatsapp",
  to,
  type: "template",
  template: {
    name,
    language: { code: lang },           // ex.: "pt_BR"
    components: [{ type: "body", parameters: [{ type: "text", text }, ...] }]
  }
}
```

Mesmo tratamento de erro/retorno do `sendText` (retorna `externalId` ou lança).

### 2. Config do template — `whatsappAccounts.settings` (sem migração)

Guardar em `settings` jsonb:

```json
{ "confirmTemplate": { "name": "confirmacao_agenda", "lang": "pt_BR" } }
```

- Campo novo em **Configurações → Integrações** para a empresa informar o nome
  do template e o idioma (atualiza `settings` via a server action de WhatsApp em
  `app/src/server/actions/settings.ts`).
- Se `confirmTemplate.name` estiver vazio, a empresa é **pulada** no cron.

### 3. Migração — coluna `reminder_sent_at` em `appointments`

- `reminder_sent_at timestamp` (nullable). Evita envio duplicado e rastreia o
  disparo. Drizzle migration + `reminderSentAt: ts("reminder_sent_at")` no schema.

### 4. Endpoint `GET /api/cron/appointment-reminders` (novo)

Protegido por `cronAuthorized(req)` (mesmo padrão do `reminders`).

Lógica:
1. Calcular a janela de "amanhã" no fuso **America/Sao_Paulo** (início e fim do
   dia seguinte em UTC).
2. Buscar `appointments` com `startsAt` dentro da janela, `status = "scheduled"`
   e `reminder_sent_at IS NULL` (limite de segurança, ex.: 1000).
3. Agrupar por empresa; para cada empresa carregar a `whatsappAccount`
   conectada (`phoneNumberId`, `accessTokenEnc`, `settings.confirmTemplate`).
   Sem conta conectada ou sem template → pular os agendamentos dessa empresa
   (contabilizar em `pulados`).
4. Para cada agendamento:
   - Resolver telefone (`contact.whatsapp ?? contact.phone`). Sem telefone →
     pular.
   - Montar parâmetros do template: nome do contato, data (`dd/MM`), hora
     (`HH:mm`), profissional (quando houver).
   - `sendTemplate(...)`.
   - Garantir/criar a `conversation` do contato e inserir uma `message`
     outbound (`direction: "outbound"`, `senderType: "system"`, `externalId`),
     para o lembrete aparecer em **Conversas** e na timeline.
   - `logActivity(... type: "message_out")`.
   - Atualizar `appointments.reminder_sent_at = now`.
   - Erro de envio em um item não derruba os demais (try/catch por item).
5. Retornar `{ enviados, pulados, erros }`.

Observação de fuso: o n8n controla **quando** executa; o endpoint sempre
resolve "amanhã" por America/Sao_Paulo, então reexecuções no mesmo dia são
idempotentes graças ao `reminder_sent_at`.

### 5. Auto-confirmação no webhook — `app/src/app/api/webhooks/whatsapp/route.ts`

Depois de inserir a mensagem inbound (bloco `for (const m of v.messages ...)`):

- Normalizar o texto recebido (minúsculas, sem acento).
- **Palavras de confirmação:** `sim`, `confirmo`, `confirmado`, `ok`, `pode sim`,
  `confirmar`, `1`.
- **Palavras de recusa:** `nao`, `não`, `cancelar`, `desmarcar`, `remarcar`, `2`.
- Buscar agendamentos **futuros** do contato com `status = "scheduled"` e
  `reminder_sent_at IS NOT NULL` (lembrete já enviado), ordenados por `startsAt`.
  - Agir **somente se houver exatamente 1** nesse estado (evita falso positivo
    com múltiplos agendamentos abertos).
  - **Confirmação:** `status → "confirmed"`; `logActivity`; notificar o
    responsável (`notifyMember`, tipo ex.: `appointment_confirmed`).
  - **Recusa:** **não altera o status**; notificar o responsável
    (`notifyMember`, tipo ex.: `appointment_decline`) com link para a agenda/cliente;
    `logActivity`.
- Mensagens que não casam com nenhuma palavra seguem o fluxo normal (nada extra).

### 6. Workflow n8n (documentação)

1. **Schedule Trigger** — diário no horário fixo escolhido (ex.: 18:00, fuso
   America/Sao_Paulo).
2. **HTTP Request** — `GET https://<app>/api/cron/appointment-reminders`,
   header `Authorization: Bearer <CRON_SECRET>`.
3. (Opcional) ramo de erro notificando um canal caso o status != 200.

## Tratamento de erros

- Endpoint: autenticação via `CRON_SECRET` (401 se faltar/errar). Falha de envio
  de um item é capturada e contabilizada em `erros` sem interromper o lote.
- Empresa sem WhatsApp conectado ou sem `confirmTemplate` → itens pulados
  (contabilizados), sem erro fatal.
- Contato sem telefone → item pulado.
- Idempotência garantida por `reminder_sent_at`.

## Testes

- **`sendTemplate`**: monta o corpo correto (nome, lang, parâmetros na ordem);
  propaga erro da Meta.
- **Seleção do cron**: só pega `scheduled` + `reminder_sent_at` nulo + janela de
  amanhã (fuso correto, incluindo virada de dia/UTC); ignora `confirmed`/
  `cancelled`/outros dias.
- **Idempotência**: segunda execução no mesmo dia não reenvia.
- **Pulos**: empresa sem template, contato sem telefone.
- **Auto-confirmação**: "SIM" com 1 agendamento pendente → `confirmed`; com 0 ou
  >1 → não altera; "NÃO" → não altera status, notifica; texto neutro → nada.

## Fora de escopo (YAGNI)

- Texto do template editável por empresa dentro do CRM (fica fixo + variáveis).
- Antecedência/horário configuráveis por empresa (horário vem do n8n).
- Botões interativos do WhatsApp (resposta é por texto).
- Remarcação automática a partir da recusa.
- Reenvio/retentativa automática de lembretes que falharam.
