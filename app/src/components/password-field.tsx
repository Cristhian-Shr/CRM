"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

/** Campo de senha com botão mostrar/ocultar (olho). */
export function PasswordField({
  name,
  required,
  autoComplete = "current-password",
  placeholder,
}: {
  name: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        name={name}
        type={show ? "text" : "password"}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="input pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1 text-muted hover:text-ink"
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
