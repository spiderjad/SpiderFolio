import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { spiderfolioPlugins } from "./plugins.vite.ts";

// En desarrollo, /api va a la API local: app y API comparten origen como en producción
// (sección 15), así la cookie del refresh (Path=/api/v1/auth) funciona sin CORS.
export default defineConfig({
  plugins: [react(), tailwindcss(), spiderfolioPlugins()],
  // Prisma Studio (CLI de Prisma, en el backend) deja React 19 en la raíz: la app usa el suyo.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  // Recharts solo se importa desde el Inicio (carga diferida): si el optimizador de Vite lo descubre
  // tarde, re-empaqueta con otro hash y el navegador recibe 504 "Outdated Optimize Dep" al pedir el
  // módulo del Inicio. Prearmado al arrancar, no hay re-empaquetado.
  optimizeDeps: { include: ["recharts"] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:4000", xfwd: true } },
  },
  build: {
    sourcemap: true,
    // Sin data: URIs (Vite incrusta assets chicos): la CSP solo admite archivos propios.
    assetsInlineLimit: 0,
  },
});
