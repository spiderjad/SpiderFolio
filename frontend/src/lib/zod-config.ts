// Zod 4 prueba new Function para validar más rápido, y lo hace al definir el primer esquema.
// Con script-src 'self' la CSP lo bloquea y lo reporta: modo sin JIT. Este módulo se importa
// primero en main.tsx, antes que cualquier esquema.
import { config } from "zod";

config({ jitless: true });
