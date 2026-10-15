/** Serviços que a agência presta a cada empresa cliente (marcados no painel master). */
export const COMPANY_SERVICES = [
  { key: "development", label: "Desenvolvimento", short: "Desenvolvimento", badge: "bg-sky-50 text-sky-700", bar: "bg-sky-500" },
  { key: "paid_traffic", label: "Tráfego pago", short: "Tráfego pago", badge: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  { key: "automation", label: "Automação (ChatBot IA)", short: "Automação IA", badge: "bg-violet-50 text-violet-700", bar: "bg-violet-500" },
  { key: "crm", label: "CRM", short: "CRM", badge: "bg-amber-50 text-amber-700", bar: "bg-amber-500" },
] as const;

export type CompanyServiceKey = (typeof COMPANY_SERVICES)[number]["key"];

/** Metadados (label/cor) de uma chave, para renderizar os selos. */
export function serviceMeta(key: string) {
  return COMPANY_SERVICES.find((s) => s.key === key);
}

/** Tipo de cobrança/recorrência de um serviço. `months` = intervalo entre pagamentos (0 = único). */
export const SERVICE_BILLINGS = [
  { key: "monthly", label: "Mensal", months: 1 },
  { key: "quarterly", label: "Trimestral", months: 3 },
  { key: "semiannual", label: "Semestral", months: 6 },
  { key: "annual", label: "Anual", months: 12 },
  { key: "one_time", label: "Único", months: 0 },
] as const;

export type ServiceBilling = (typeof SERVICE_BILLINGS)[number]["key"];

export const SERVICE_BILLING_KEYS: readonly string[] = SERVICE_BILLINGS.map((b) => b.key);

export function billingLabel(key: string) {
  return SERVICE_BILLINGS.find((b) => b.key === key)?.label ?? key;
}

/** Intervalo em meses entre pagamentos da recorrência (0 = único). */
export function billingMonths(key: string): number {
  return SERVICE_BILLINGS.find((b) => b.key === key)?.months ?? 1;
}

/** Valor mensal equivalente de um serviço recorrente (ex.: anual R$1200 → R$100/mês). Único = 0. */
export function monthlyEquivalentCents(valueCents: number, billing: string): number {
  const months = billingMonths(billing);
  return months > 0 ? Math.round(valueCents / months) : 0;
}

/** Formas de pagamento da comanda (uma por empresa). */
export const PAYMENT_METHODS = [
  { key: "pix", label: "Pix" },
  { key: "boleto", label: "Boleto" },
  { key: "card", label: "Cartão" },
  { key: "transfer", label: "Transferência" },
  { key: "cash", label: "Dinheiro" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["key"];

export const PAYMENT_METHOD_KEYS: readonly string[] = PAYMENT_METHODS.map((p) => p.key);

export function paymentMethodLabel(key: string | null | undefined) {
  return PAYMENT_METHODS.find((p) => p.key === key)?.label ?? "—";
}

/** Um serviço contratado por uma empresa, como vem do formulário/banco. */
export type CompanyService = { service: string; valueCents: number; billing: string; installments: number };

/**
 * Lê do FormData os serviços marcados e seus valores/cobrança/parcelas.
 * Convenção de campos: `svc_<key>` (checkbox), `value_<key>`, `billing_<key>`, `installments_<key>`.
 */
export function parseCompanyServices(
  fd: FormData,
  parseMoney: (v: FormDataEntryValue | string | null | undefined) => number,
): CompanyService[] {
  return COMPANY_SERVICES.filter((s) => fd.get(`svc_${s.key}`) != null).map((s) => {
    const billing = String(fd.get(`billing_${s.key}`) ?? "monthly");
    const n = Math.floor(Number(fd.get(`installments_${s.key}`)));
    return {
      service: s.key,
      valueCents: parseMoney(fd.get(`value_${s.key}`)),
      billing: SERVICE_BILLING_KEYS.includes(billing) ? billing : "monthly",
      installments: Number.isFinite(n) && n >= 1 && n <= 120 ? n : 12,
    };
  });
}
