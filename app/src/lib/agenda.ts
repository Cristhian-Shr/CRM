export const STATUS_LABEL: Record<string, string> = {
  scheduled: "Marcado",
  confirmed: "Confirmado",
  waiting: "Aguardando",
  in_progress: "Em andamento",
  done: "Atendido",
  no_show: "Faltou",
  cancelled: "Desmarcado",
};

export const STATUS_COLOR: Record<string, string> = {
  scheduled: "#3b82f6",
  confirmed: "#1e3a8a",
  waiting: "#eab308",
  in_progress: "#a855f7",
  done: "#16a34a",
  no_show: "#991b1b",
  cancelled: "#d946ef",
};

export const APPOINTMENT_TYPES: Record<string, string> = {
  evaluation: "Avaliação",
  procedure: "Procedimento",
  return: "Retorno",
};
