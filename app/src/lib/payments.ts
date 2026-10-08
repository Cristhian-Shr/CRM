/** Formas de pagamento usadas em comandas, orçamentos e contas a receber. */
export const PAYMENT_METHODS = [
  { key: "cash", label: "Dinheiro" },
  { key: "pix", label: "Pix" },
  { key: "debit", label: "Cartão de Débito" },
  { key: "credit", label: "Cartão de Crédito" },
] as const;

export function paymentLabel(key: string | null | undefined) {
  return PAYMENT_METHODS.find((m) => m.key === key)?.label ?? "—";
}
