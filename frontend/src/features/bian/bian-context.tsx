// Acceso a Bian desde cualquier pantalla: abrir el panel con una pregunta, un resumen o un «qué
// cambió» sobre un documento. El panel vive en el marco de la app (AppShell).
import { createContext, useContext } from "react";
import type { BianRequest } from "./bian-api";

export interface BianActions {
  /** Abre el panel de Bian; con una petición, la envía al abrir. */
  open: (request?: BianRequest) => void;
}

export const BianContext = createContext<BianActions | null>(null);

export function useBian(): BianActions {
  const value = useContext(BianContext);
  if (value === null) throw new Error("useBian fuera del marco de la app");
  return value;
}
