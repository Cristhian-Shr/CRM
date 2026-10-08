/** Serviços que a agência presta a cada empresa cliente (marcados no painel master). */
export const COMPANY_SERVICES = [
  { key: "development", label: "Desenvolvimento", short: "Desenvolvimento", badge: "bg-sky-50 text-sky-700", bar: "bg-sky-500" },
  { key: "paid_traffic", label: "Tráfego pago", short: "Tráfego pago", badge: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  { key: "automation", label: "Automatização (ChatBot IA)", short: "Automação IA", badge: "bg-violet-50 text-violet-700", bar: "bg-violet-500" },
  { key: "crm", label: "CRM", short: "CRM", badge: "bg-amber-50 text-amber-700", bar: "bg-amber-500" },
] as const;

export type CompanyServiceKey = (typeof COMPANY_SERVICES)[number]["key"];

/** Metadados (label/cor) de uma chave, para renderizar os selos. */
export function serviceMeta(key: string) {
  return COMPANY_SERVICES.find((s) => s.key === key);
}

/** Tipo de cobrança de um serviço contratado. */
export const SERVICE_BILLINGS = [
  { key: "monthly", label: "Mensal" },
  { key: "one_time", label: "Único" },
] as const;

export type ServiceBilling = (typeof SERVICE_BILLINGS)[number]["key"];

export const SERVICE_BILLING_KEYS: readonly string[] = SERVICE_BILLINGS.map((b) => b.key);

export function billingLabel(key: string) {
  return SERVICE_BILLINGS.find((b) => b.key === key)?.label ?? key;
}

/** Um serviço contratado por uma empresa, como vem do formulário/banco. */
export type CompanyService = { service: string; valueCents: number; billing: string };

/**
 * Lê do FormData os serviços marcados e seus valores/cobrança.
 * Convenção de campos: `svc_<key>` (checkbox), `value_<key>`, `billing_<key>`.
 */
export function parseCompanyServices(
  fd: FormData,
  parseMoney: (v: FormDataEntryValue | string | null | undefined) => number,
): CompanyService[] {
  return COMPANY_SERVICES.filter((s) => fd.get(`svc_${s.key}`) != null).map((s) => {
    const billing = String(fd.get(`billing_${s.key}`) ?? "monthly");
    return {
      service: s.key,
      valueCents: parseMoney(fd.get(`value_${s.key}`)),
      billing: SERVICE_BILLING_KEYS.includes(billing) ? billing : "monthly",
    };
  });
}
