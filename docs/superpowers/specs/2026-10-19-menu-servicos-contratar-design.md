# Menu de serviços para contratar (lado da empresa) — Design

**Data:** 2026-10-19
**Autor:** Cristhian S. Schröer (com Claude)

## Objetivo

Dar ao admin da empresa cliente uma tela para ver os serviços da agência e
**solicitar a contratação** dos que ainda não tem. A agência recebe as
solicitações numa lista no painel master e ativa pelo fluxo atual.

## Decisões (brainstorming)

| Tema | Decisão |
|------|---------|
| Ação do "Contratar" | **Enviar solicitação à agência** (preço é negociado, não self-checkout) |
| Lado agência | **Lista no painel master** (pendente → resolvida), com link para a empresa |

## Contexto do que já existe

- 4 serviços da agência em `lib/services.ts` (`COMPANY_SERVICES`): development,
  paid_traffic, automation, crm.
- `company_services` (empresa + serviço + valor/recorrência) definido pelo master
  via `setCompanyServices` (`server/actions/master.ts:147`). Não há catálogo de
  preço global; valor é por empresa.
- Painel master com atalhos em `app/(master)/master/page.tsx`; auth via
  `requireMaster()`. Sidebar da empresa com itens `adminOnly` em
  `components/layout/sidebar.tsx`.
- `getContext()` dá `role` ("admin"), `companyId`, `userId`.

## Arquitetura

### 1. Modelo de dados — `service_requests` (nova tabela)

```
id, companyId, service (text), status (pending|resolved|cancelled, default pending),
note (text), requestedBy (users.id), createdAt, resolvedAt, resolvedBy (users.id)
```
Índice por (status, companyId). Migração Drizzle. Tabela nova e isolada —
nada muda no fluxo atual.

### 2. `lib/services.ts` — descrição dos serviços

Adicionar `description` curta a cada item de `COMPANY_SERVICES` (fonte única,
usada na vitrine).

### 3. Lado empresa

- **Sidebar** (`components/layout/sidebar.tsx`): novo item `adminOnly`
  **"Serviços"** (ícone `ShoppingBag`) → `/servicos`.
- **Página `app/(app)/servicos/page.tsx`** (server component, admin-only; não-admin
  é redirecionado): lista os 4 serviços com descrição. Estado por serviço:
  - Em `company_services` → selo **"Ativo"**.
  - Pedido `pending` em `service_requests` → selo **"Solicitado · aguardando"**.
  - Senão → botão **"Solicitar contratação"** (Modal com observação opcional).
  - Sem preço exibido.
- **Ação `server/actions/services.ts` → `requestService(fd)`**: valida a chave do
  serviço (deve existir em `COMPANY_SERVICES`); rejeita se já ativo ou já houver
  pedido `pending`; grava `pending` com `requestedBy = userId`. Revalida `/servicos`.

### 4. Lado agência (master)

- **Ação `server/actions/master.ts` → `resolveServiceRequest(id)`**: `requireMaster`;
  marca `resolved` + `resolvedAt`/`resolvedBy`; `audit`; revalida `/master` e
  `/master/solicitacoes`.
- **Página `app/(master)/master/solicitacoes/page.tsx`**: lista pedidos `pending`
  (join com `companies` para o nome): empresa, serviço (selo via `serviceMeta`),
  data, observação; link para `/master/empresas` (onde ativa) e botão
  **"Marcar como resolvida"**. `Empty` quando não há pendências.
- **Atalho** em `master/page.tsx`: **"Solicitações"** com contador de pendentes.

## Tratamento de erros / permissões

- `requestService` roda com `getContext()` (admin da empresa) e usa `safe()`;
  mensagens amigáveis para duplicado/serviço inválido.
- `resolveServiceRequest` exige `requireMaster()`.
- Página `/servicos` redireciona não-admin; item só aparece no menu para admin.

## Testes / verificação

- Solicitar um serviço inativo → vira "Solicitado"; aparece na lista do master.
- Não permite segundo pedido pendente do mesmo serviço nem pedir serviço já ativo.
- Master "Marcar como resolvida" tira da lista e zera o contador.
- Typecheck limpo.

## Fora de escopo (YAGNI)

- Catálogo de preço self-service / contratação automática.
- Cancelar/editar solicitação pela empresa.
- Notificação por e-mail/WhatsApp da solicitação (fica só na lista do master).
- Histórico de solicitações resolvidas (lista mostra só pendentes).
