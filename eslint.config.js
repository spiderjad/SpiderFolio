// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { limitKeys } from "@spiderfolio/limits";

// Límites (docs/spec/limites.md): los valores los fija cada empresa en Workspace.limits; nada de
// escribirlos en el código. Los tests pueden usar límites literales para verificar comportamiento.
const limitNames = limitKeys.join("|");
const planImportPaths = [];
const planImportPatterns = [
  {
    group: ["**/packages/limits/src/**", "@spiderfolio/limits/src/**"],
    message: "Importá desde @spiderfolio/limits.",
  },
];
const limitSyntax = [
  {
    selector: `Property:matches([key.name=/^(${limitNames})$/], [key.value=/^(${limitNames})$/]) > Literal.value[raw=/^[0-9]/]`,
    message: "Los límites los fija cada empresa, no el código (docs/spec/limites.md).",
  },
];
const planSyntax = limitSyntax;
// SQL en crudo (CLAUDE.md, sección 7.4): solo en backend/src/db/raw, con workspaceId explícito.
const rawSqlSyntax = [
  {
    selector: String.raw`MemberExpression[property.name=/^\$(queryRaw|executeRaw)(Unsafe|Typed)?$/]`,
    message: "SQL en crudo solo en backend/src/db/raw (CLAUDE.md, sección 7.4).",
  },
];

const transactionClientSyntax = {
  selector: 'ImportSpecifier[imported.name="transactionClientOf"]',
  message: "transactionClientOf es solo para backend/src/jobs (CLAUDE.md, sección 7.4).",
};

export default defineConfig(
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/coverage/",
    "**/.astro/",
    "backend/src/generated/",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "web/astro.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["packages/limits/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: planImportPaths, patterns: planImportPatterns }],
      "no-restricted-syntax": ["error", ...planSyntax, ...rawSqlSyntax],
    },
  },
  {
    // SQL en crudo solo en db/raw.
    files: ["backend/src/db/raw/**"],
    rules: { "no-restricted-syntax": ["error", ...planSyntax] },
  },
  {
    // Tests: pueden usar SQL en crudo (inspeccionar pgboss) y límites literales.
    files: ["**/tests/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // transactionClientOf (el tx base detrás de un TenantDb) solo lo usa jobs/ para encolar.
    files: ["backend/src/**"],
    ignores: ["backend/src/jobs/**", "backend/src/db/tenant.ts", "backend/src/db/raw/**"],
    rules: {
      "no-restricted-syntax": ["error", ...planSyntax, ...rawSqlSyntax, transactionClientSyntax],
    },
  },
  {
    // Las rutas usan req.db (forTenant) y servicios; nunca el cliente base.
    files: ["backend/src/**/*.routes.*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: planImportPaths,
          patterns: [
            ...planImportPatterns,
            {
              group: ["**/lib/prisma*", "**/generated/prisma/**"],
              message: "Las rutas usan req.db (forTenant) o servicios (CLAUDE.md, sección 7.4).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...planSyntax,
        ...rawSqlSyntax,
        transactionClientSyntax,
        {
          selector: 'MemberExpression[property.name="prisma"]',
          message: "Las rutas usan req.db (forTenant) o servicios (CLAUDE.md, sección 7.4).",
        },
      ],
    },
  },
  {
    // App: navegador. El access token vive solo en memoria (7.1): nada de Web Storage salvo la
    // preferencia de tema; HTML sin sanitizar prohibido (12).
    files: ["frontend/**/*.{ts,tsx,js}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Confirmaciones y avisos con ConfirmDialog o un Dialog propio, nunca los nativos.
      "no-alert": "error",
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "El token vive en memoria (CLAUDE.md, 7.1)." },
        { name: "sessionStorage", message: "El token vive en memoria (CLAUDE.md, 7.1)." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "localStorage",
          message: "Solo en src/lib/theme.ts, kiosk.ts, sidebar.ts e i18n/index.ts.",
        },
        { object: "window", property: "sessionStorage", message: "No se usa sessionStorage." },
      ],
      "no-restricted-syntax": [
        "error",
        ...planSyntax,
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message: "HTML solo con DOMPurify y en un componente revisado (CLAUDE.md, sección 12).",
        },
      ],
    },
  },
  {
    // theme.ts guarda la preferencia de tema; kiosk.ts, el código público del workspace de una
    // tablet compartida (nunca el usuario ni credenciales); i18n/index.ts, el último idioma usado.
    // Ver CLAUDE.md, 7.1 y 7.6.
    files: [
      "frontend/src/lib/theme.ts",
      "frontend/src/i18n/index.ts",
      "frontend/src/lib/kiosk.ts",
      "frontend/src/lib/sidebar.ts",
      "frontend/public/compat.js",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  {
    // Scripts clásicos ES5 del navegador de la web: theme-init.js (aplica el tema antes del primer
    // pintado) y lang-redirect.js (la portada / elige el idioma).
    files: ["web/public/theme-init.js", "web/public/lang-redirect.js"],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    // compat.js es ES5: el catch necesita su parámetro aunque no se use.
    files: ["frontend/public/compat.js"],
    rules: { "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    // Tests y E2E: pueden inspeccionar el almacenamiento para comprobar que está vacío.
    files: ["frontend/tests/**", "frontend/e2e/**"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" },
  },
  {
    files: ["**/*.js", "web/astro.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
