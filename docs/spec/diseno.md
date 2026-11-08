10. Diseño (spider-ui, mismo sistema en app y web)
    10.1 Dirección visual

El sistema de diseño es el paquete **spider-ui** (repositorio privado spiderjad/spider-ui, instalado con el commit fijado: `github:spiderjad/spider-ui#<sha>`, dependencia de packages/tailwind-preset). Es la única fuente de colores, tipografía, radios y sombras. Su guía viaja con el paquete (node_modules/spider-ui/GUIDE.md) y manda sobre esta sección. Para actualizarlo: `npm install -w @spiderfolio/tailwind-preset github:spiderjad/spider-ui#<commit nuevo>`. Nada dentro de node_modules/spider-ui se edita; si falta un componente que se repite en varios proyectos, se propone en spider-ui.

Panel (la app: listados, formularios, ajustes, editores): estilo Vercel con el violeta de spider-ui (--sp-primary) como color de marca. Fondo blanco, superficies gris muy claro, borde de 1 px suave; botón primario violeta (una sola acción principal por vista), ítem activo y enlaces en violeta, secundario blanco con borde, rojo solo para borrar. Verde, ámbar y rojo solo para estados. Clases `v-*`. Decisión de SpiderFolio: se aparta del panel monocromo de la guía de spider-ui (botón negro); donde se use `v-btn-primary`, se le da el violeta con CSS propio del proyecto.
Acceso (login, registro, recuperar, código, bienvenida): estilo Stripe, violeta y ámbar. Clases `auth-*` con la estructura completa de la guía. No se mezclan los dos sistemas en una pantalla.
Tipografía Inter (--sp-font) para todo. Etiquetas en mayúsculas con espaciado para estructurar sin cajas extra. Íconos lineales finos (lucide, strokeWidth={1.75}).
Modo oscuro desde el día 1 (botón luna en web y app): spider-ui lo toma de `data-theme` en `<html>`; la app y la web ponen `data-theme` y la clase `.dark` (para la variante `dark:` de Tailwind) a la vez (frontend/public/compat.js, frontend/src/lib/theme.ts, web/public/theme-init.js y Header.astro).
Colores: solo `var(--sp-*)`, los alias del preset (abajo) o las clases `spider-*`. Nunca hex sueltos ni la paleta de Tailwind.
10.2 Tokens (packages/tailwind-preset)

Los componentes existentes usan clases semánticas (bg-primary, text-muted-foreground, border-border…). packages/tailwind-preset/tokens.css (generado por src/tokens-css.ts con `npm run tokens:css -w @spiderfolio/tailwind-preset`, no se edita a mano) define cada una como alias de un token de spider-ui:

| Token del preset | spider-ui |
|---|---|
| background / surface / muted | --sp-bg / --sp-bg-subtle / --sp-bg-muted |
| foreground / muted-foreground | --sp-text-primary / --sp-text-secondary |
| border / input / ring | --sp-border / --sp-border / --sp-primary |
| primary / primary-foreground | --sp-primary / --sp-on-primary (violeta de la marca) |
| primary-soft / primary-soft-foreground | --sp-primary-light / --sp-primary-text (ítem activo, chips) |
| success, warning, danger | --sp-success, --sp-warning, --sp-danger; -foreground: --sp-bg |
| X-soft / X-soft-foreground | --sp-X-light / --sp-X (danger: --sp-danger-text) |
| radius (sm, md, lg) / xl, 2xl | --sp-radius (6 px, botones) / --sp-radius-lg (10 px, tarjetas) |
| shadow-card / shadow-pop | --sp-shadow / --sp-shadow-md |

El bloque @theme inline borra la paleta de Tailwind (--color-*: initial) y mapea --color-<token>: var(--<token>); la opacidad funciona con la sintaxis normal (bg-primary/50, vía color-mix). En CSS propio se usa var(--<token>) o var(--sp-*), nunca hsl(var(--x)). No hay bloque .dark: los valores cambian con los de spider-ui.

Color de acento por workspace: Workspace.accentColor es null por defecto (= violeta de spider-ui) y solo se guarda si el cliente elige otro, como #rrggbb en minúsculas. El backend lo valida con HEX_COLOR_RE (#RRGGBB) y lo normaliza con normalizeHex (@spiderfolio/tailwind-preset/accent, sin dependencias de Tailwind). La app calcula las variables con accentTokens(hex) (--primary, --primary-foreground, --primary-soft, --primary-soft-foreground y --ring, distintas para claro y oscuro; primaryForegroundFor elige blanco o casi negro según el contraste) y las aplica como hsl(...) con document.documentElement.style.setProperty, volviendo a aplicarlas al cambiar de tema. Nunca con <style> en línea (CSP). Si accentIsLowContrastText(hex) es true, la configuración avisa que los enlaces se leerán mal, sin bloquear. Los valores HSL de src/tokens.ts quedan solo para esas cuentas de contraste.

Preset (Tailwind 4, configurado en CSS): app y web hacen @import "tailwindcss"; y @import "@spiderfolio/tailwind-preset/preset.css";. preset.css no contiene valores de color: importa tw-animate-css, spider-ui/spider-ui.css (tokens, v-* y auth-*), tokens.css y spider-ui/tailwind-v4.css (clases spider-*), carga @tailwindcss/typography con @plugin, define la variante dark por clase (@custom-variant dark (&:where(.dark, .dark *))), las fuentes (--font-sans y --font-mono de spider-ui; --font-display "Instrument Serif" solo en la web, pendiente de pasar a spider-ui), los radios, las sombras, los estilos base (bordes, body, prefers-reduced-motion) y el tema de prose con los tokens (@utility prose).

10.3 Tipografía
Uso Clases
Título display (héroe web, portada de docs) font-display text-5xl md:text-6xl tracking-tight
Título de página en la app text-2xl font-semibold tracking-tight
Título de tarjeta o sección text-base font-semibold
Texto de interfaz 14 px (body y text-sm); controles de 36 px (h-9), botones pequeños de 32 px (h-8)
Texto secundario 13 px (text-xs en la app) text-xs text-muted-foreground
Etiquetas de grupo text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground
Números de KPI text-4xl font-semibold tracking-tight tabular-nums
Docs y editor prose (17 px, interlineado 1.75 y colores de los tokens, definidos en el preset; no hace falta prose-invert)
10.4 Layout de la app (referencia: captura del panel)
Desde el 07/11/2026 la navegación es por áreas (10.4.1): a la izquierda, la barra de áreas de 64 px y, al lado, el menú del área (la sidebar de abajo, que ahora muestra solo las secciones del área activa).
Sidebar blanca de 260 px con borde derecho (el menú del área):
Arriba: logo del workspace + nombre, botón para colapsar (<), el buscador y el «+» de crear, y el título del área.
Las secciones del área, con grupos de etiqueta en mayúsculas cuando hacen falta (Inicio: Panel, Mis pendientes y Recientes; Wiki: Espacios, Compartidos y Favoritos; Prevención: sus secciones, «Lo mío» y «Documentos del área»; Documentación: lo controlado y sus espacios).
Ítem: ícono + texto, h-10 px-3 rounded-lg; activo con bg-primary-soft text-primary-soft-foreground font-medium; contadores a la derecha como pastillas pequeñas (neutras o danger-soft si urgen).
Abajo, separado por borde: nombre del workspace en gris, avatar con iniciales sobre fondo primario, nombre, insignia de rol (ADMIN en primary-soft) y botón de cerrar sesión con ícono.
Colapsada: solo íconos con tooltip (Ctrl+B). Por debajo de 1024 px: Sheet que se abre desde el título de la barra superior.
Barra superior fina con el título de la sección a la izquierda, fecha en gris y, a la derecha, lo transversal: Mis pendientes (con su número), Pregúntale a Bian, el buscador y la campana.
Contenido sobre bg-surface, max-w-[1400px], padding px-4 sm:px-6 lg:px-8 py-6: título grande + fecha o subtítulo en gris, y luego bloques.
10.4.1 Navegación por áreas (decidida el 07/11/2026, opción B de docs/plans/navegacion/propuesta.html) (hecha)
Problema: el menú plano (Inicio, Mis documentos, Archivos, Compartido, Aprobaciones, Vencimientos, Prevención, 12 de Administración y los espacios) ya no escala con Prevención, la CAE y Calidad.

Estructura: **barra de áreas + menú del área**.
- Barra de áreas: columna fija de 64 px a la izquierda, con un ícono y un nombre corto por área; el área activa en primary-soft. Abajo de todo, separada, Administración (engranaje). Si la persona ve una sola área de trabajo, la barra se oculta y queda solo el menú.
- Menú del área: la columna actual (260 px), con el título del área arriba y solo sus secciones. Las pestañas internas de cada módulo (Prevención: Resumen, Personas, EPI, Formación, Accidentes, Planificación, Indicadores, Contratas…) se mantienen dentro de su pantalla.
- Celular (< 768 px): las áreas pasan a una barra inferior (hasta 4 áreas + «Más»); el menú del área se abre como Sheet desde el título.

Áreas:
| Área | Contenido | Quién la ve |
|---|---|---|
| Inicio | Panel, Mis pendientes (lecturas, aprobaciones, formularios de hoy, medidas, vencimientos), notificaciones | Todos |
| Documentación | Documentos controlados, Mis lecturas, Aprobaciones, Vencimientos, Salas de auditoría, y los formularios de los espacios de Documentación | Todos (cada uno lo suyo) |
| Wiki | Espacios y páginas de los departamentos, Archivos, Compartido conmigo | Todos, según el acceso de cada espacio |
| Prevención | El módulo de Seguridad y salud entero, CAE incluida | Con el módulo activo: safety.manage, safety.health, jefes (su área), cae.check (solo la CAE) y cada persona para su ficha |
| Calidad | El módulo de Calidad (docs/plans/2026-11-07-modulo-calidad.md) | Con el módulo activo, por sus capacidades |
| Administración | Miembros, Departamentos, Puestos, Roles, Accesos, Seguridad, Bian, Límites, Licencia y plugins, Auditoría | Según canSee de hoy |

Decisiones:
- **Wiki y Documentación separadas**: la Wiki es el día a día de cada departamento; Documentación es lo controlado y auditable.
- **Formularios en su área**: cada espacio pertenece a un área (`Space.area`: `wiki` por defecto; el espacio de Prevención es `prl`; el de Calidad, `quality`; un admin puede cambiarlo). Un formulario aparece en el área de su espacio; Mis pendientes los junta todos para quien tiene que llenarlos.
- **Administración es un área de la barra**, abajo, solo para quien puede administrar algo.
- **Lo transversal** queda fuera de las áreas, siempre visible en la barra superior: buscador (⌘K), Mis pendientes, notificaciones y Bian.
- **Área de entrada**: la elige la empresa por departamento (`Department.homeArea`) y cada persona puede cambiarla en su perfil (`Membership.homeArea`, gana sobre la del departamento). Por defecto, Inicio.
- Las rutas no cambian (`/app/:slug/seguridad`, `/files`…); el área activa se deduce de la ruta, así los enlaces y QR existentes siguen sirviendo.
- Un área sin nada que mostrarle a la persona no aparece en su barra.

Implementación (07/11/2026):
- Datos (migración `navigation_areas`): `Space.area` (`SpaceArea`: `WIKI` por defecto, `DOCUMENTS`, `PREVENTION`, `QUALITY`); el espacio del módulo de Prevención pasa a `PREVENTION` al crearse y, para los que ya existían, con un UPDATE de datos en la misma migración (por `settings.safety.spaceId`). `Department.homeArea?` y `Membership.homeArea?` (`HomeArea`: `HOME`, `DOCUMENTS`, `WIKI`, `PREVENTION`, `QUALITY`, `ADMIN`). La cuenta (`/auth/me`) devuelve por membresía `homeArea` y `departmentHomeArea` (el del primer departamento por nombre que tenga uno).
- Quién cambia qué: el área de un espacio, quien tiene `spaces.manage` (en la configuración del espacio, «Área de la app»; el resto recibe 403 si lo intenta); el área de entrada de un departamento, quien puede editarlo («Área de entrada»); la propia, cada persona en Mi perfil (`PATCH /w/:slug/profile/home-area`). `GET /spaces?area=` filtra por una o varias áreas (separadas por comas).
- Frontend: `frontend/src/components/nav-areas.ts` arma las áreas y sus secciones con las capacidades de hoy (`canSee`, las de Prevención y la CAE) y deduce el área activa de la ruta (la entrada más profunda que contiene la dirección; las pantallas de un espacio, por el área del espacio). `app-shell.tsx`: barra de áreas (≥ 768 px), menú del área (≥ 1024 px; por debajo, Sheet desde el título), barra inferior en el celular (< 768 px: hasta 4 áreas y «Más» con el resto y Administración). Accesibilidad: `nav` con `aria-label` («Áreas»), `aria-current="page"` en el área y la entrada activas, foco visible, tooltips con el nombre completo.
- Áreas y secciones: Inicio (Panel, Mis pendientes, los plugins con pantalla propia y Recientes); Documentación (Mis lecturas, Aprobaciones, Vencimientos, Documentos controlados, Salas de auditoría y sus espacios); Wiki (Espacios, Compartidos, Departamentos en solo lectura para quien no los gestiona, y Favoritos); Prevención (Resumen, Personas, EPIs, Catálogo, Formación, Accidentes, Planificación, Indicadores, Emergencias, Comité, Contratas, según los permisos de cada sección; «Lo mío»: Mi ficha, Mis medidas, Comunicar un accidente; y los espacios del área); Administración (el resto de las secciones del panel). Nombre corto de Prevención en la barra: «PRL» (es) / «SST» (latam). Calidad está definida pero no se muestra hasta que exista su módulo.
- La barra de pestañas de Prevención (`PpeTabs`) se quitó: sus secciones están en el menú del área; quedan las pestañas internas de la CAE, Emergencias y el Comité.
- Mis pendientes: `/app/:slug/pendientes` junta lo que ya había (lecturas y aprobaciones del resumen del Inicio, formularios por llenar, vencimientos propios, medidas de Prevención sin hacer y el aviso de EPI y formación). El número de la barra superior suma lecturas, aprobaciones, formularios, vencimientos y, para quien no gestiona Prevención, su número del módulo. El Inicio de siempre queda como «Panel».
- Entrada: al abrir `/app/:slug` (al iniciar sesión o desde un marcador) la app va al área de entrada (`Membership.homeArea` ?? `departmentHomeArea` ?? Inicio) solo la primera vez en esa carga de la página; una dirección más profunda no se toca, y «Panel» sigue llevando al Inicio.
- Simplificaciones: la lista de Archivos (área Wiki) muestra solo los espacios `WIKI` salvo al buscar o con el filtro Favoritos, que siguen mostrando todos; las áreas no Wiki listan entre todas hasta 40 espacios en su menú (un solo pedido); Calidad nunca aparece (ni en la barra ni como opción de área de entrada o de espacio) hasta que exista el módulo; el área de entrada de un departamento se elige al editarlo (no al crearlo); la barra se oculta con una sola área de trabajo (Administración queda entonces en el menú).
10.5 Componentes clave (todos en frontend/src/components/ui)
Banner de aviso: bg-warning-soft con borde ámbar, ícono de advertencia, texto con el número en negrita y botón ámbar a la derecha ("Tienes 4 documentos pendientes de aprobar · Ver lista").
Tarjeta KPI: blanca, rounded-2xl border p-4 sm:p-5, etiqueta en mayúsculas espaciada y número grande debajo. En grilla de 4 columnas (2 en tablet, 1 en móvil).
Tarjeta de gráfico: título font-semibold arriba, Recharts con barras redondeadas arriba (radius={[6,6,0,0]}), grilla punteada muy suave, ejes sin línea, tooltips propios. Serie 1 en primario, serie 2 en success.
Tabla: cabecera en mayúsculas espaciadas y gris, filas de 48 px con separador fino, avatar circular con iniciales y color derivado del nombre, estado como pastilla suave (Pendiente en ámbar, Vigente en verde, En revisión en primario, Obsoleto en gris).
Ranking ("Top documentos más leídos"): número de posición en gris, nombre y contador en pastilla primary-soft a la derecha.
Resto del kit: Button (primary violeta, secondary, ghost, outline, destructive; rounded-lg), Input, Select, Combobox, Checkbox, Switch, Badge, Avatar, Tooltip, DropdownMenu, ContextMenu, Popover, Dialog, AlertDialog, Sheet, Tabs, Breadcrumbs, Skeleton, ScrollArea, DataTable (TanStack), EmptyState, FileIcon, ProgressBar, Kbd, Command (cmdk), Toaster (sonner), ThemeToggle. Accesibles (Radix), foco visible ring-2 ring-primary/40.
10.6 Pantallas de la app
Estado (Parte 5 del Módulo 1): login, registro, verificación, recuperar, restablecer y el inicio tienen la maquetación final, revisada en claro, oscuro y a 375 px. Solo hay captura de referencia de la documentación de la web (docs/design-reference/); de ella salen el ítem activo con borde suave, la etiqueta con ícono en cuadrado tintado (IconTile) y las tarjetas con ícono sólido. Cuando se sumen capturas del panel y de auth, se comparan lado a lado y se ajusta. El inicio muestra ceros y estados vacíos que explican qué va a aparecer (datos de GET /api/v1/w/:slug/overview), nunca datos de ejemplo. Los ítems del sidebar de módulos que todavía no existen están ocultos. La fecha va en la barra superior; el encabezado del inicio saluda con el nombre del workspace. El aviso de prueba es un Banner informativo (violeta suave); el ámbar queda para lo que pide atención.
Inicio (dashboard): título + fecha; banner si hay pendientes; KPIs (documentos vigentes, pendientes de aprobación, lecturas pendientes, almacenamiento usado); gráficos "Actividad — últimos 30 días" y "Documentos publicados — últimos 6 meses"; tabla "Mis pendientes" y ranking "Más consultados del mes".
Auth (login, registro, recuperar, restablecer, aceptar invitación, verificación, condiciones, PIN de planta y los portales externos: sala del auditor, portal de contratas y autorizar una app): `auth-*` de spider-ui con su estructura completa. Fondo oscuro animado, tarjeta blanca de 420 px con el logo, el título y el formulario, y el selector de idioma arriba a la derecha de la tarjeta; el pie (enlaces como «Crear cuenta») va dentro de la tarjeta con `auth-alt`. Se ven igual en claro y en oscuro: `AuthLayout` fuerza el tema claro mientras está abierta y lo devuelve al salir. Los componentes compartidos (Button, Input, PasswordInput, Label, FormField, Checkbox, Banner, FormAlert) se dibujan con `auth-*` dentro de `AuthLayout` (`components/ui/surface.tsx`): el primario es `auth-btn`, el secundario `auth-secondary-btn`, los enlaces `auth-link`.
Explorador de archivos, página con editor, diálogo Compartir y panel de administración: siguen la sección 9 y estas mismas piezas (tablas, tarjetas, pastillas, banners).
10.7 Web pública (referencia: capturas de funciones y docs)
Header fijo y blanco con borde inferior: logo a la izquierda, menú centrado (Funciones, Por qué, Precios, FAQ, Docs) en gris que pasa a negro al pasar el mouse o en la sección activa, selector de idioma (ES ˅), botón de tema (luna) y CTA negro en forma de pastilla "Empezar gratis". En móvil, menú hamburguesa en Sheet.
Inicio (una sola página con anclas, más páginas propias si crecen):
Héroe: etiqueta en mayúsculas, título grande en font-display, subtítulo, CTA principal + secundario ("Ver documentación"), captura del panel dentro de un marco con borde y sombra suave.
Funciones: grilla de tarjetas rounded-2xl con ícono en cuadrado de color tintado (verde, ámbar, violeta, azul), título y lista con checks violetas (Archivos y carpetas, Permisos por departamento, Documentos controlados, Auditoría, Asistente IA, Administración).
Por qué: comparación "Carpetas compartidas vs. SpiderFolio" (el dolor de OneDrive), en bloques sobrios.
Ediciones: Community, Plugins y Enterprise (el recomendado, con borde primario), más un bloque de servicios que lleva a la página Plugins y servicios. La web no publica precios: la página Plugins y servicios es un catálogo con descripción y un botón «Contactar» (email de contacto con el asunto del plugin o servicio).
FAQ: acordeón (Radix vía isla React o <details> estilizado).
CTA final y footer con columnas (Producto, Recursos, Legal, Contacto).
Documentación (/docs), tres columnas:
Izquierda: navegación agrupada con etiquetas en mayúsculas (EMPEZAR, USO DIARIO, ADMINISTRACIÓN, SEGURIDAD), ítem activo con bg-primary-soft e ícono por guía.
Centro: breadcrumb "Docs", buscador con atajo ⌘K (Pagefind), etiqueta con ícono, título en font-display, introducción en gris grande, tarjetas de acceso rápido con ícono violeta sólido y enlace "Empezar →", y el contenido en prose.
Derecha: "EN ESTA PÁGINA" con la tabla de contenidos, marcador violeta en la sección visible y "↑ Volver arriba".
Fondo con degradado violeta tenue arriba.
Seguridad y Plantillas: ver 9C.10.
Legales, en español e inglés y enlazadas desde el pie con su fecha de última actualización (`LEGAL_UPDATED` en web/src/config/site.ts): aviso legal, privacidad (RGPD), términos de uso y cookies. La web no usa cookies (solo guarda en el navegador el tema y el idioma elegidos), así que no hay banner de cookies.
SEO: título y descripción por página, Open Graph con imagen, sitemap, robots.txt, datos estructurados SoftwareApplication y FAQPage, URLs limpias en español, Lighthouse ≥ 95 en todo.
10.8 Movimiento

Reglas comunes: 150–300 ms, ease-out, animar solo transform y opacity (el borde del hover es la única excepción de color), y todo desactivado con prefers-reduced-motion. Mejora progresiva: sin soporte del navegador, el contenido aparece directo y nada queda oculto. Sin librerías de animación: CSS y JavaScript nativos.

Tokens (packages/tailwind-preset/preset.css, únicas fuentes; nada de duraciones ni curvas sueltas en pantallas): --motion-duration-fast 150 ms, --motion-duration-base 200 ms, --motion-duration-slow 300 ms, --motion-ease-out, --motion-ease-emphasized (entradas), --motion-distance 8 px, --motion-scale-from 0.98. Con reduced-motion las duraciones y desplazamientos valen 0.

App (sutil y rápida):

- Entre pantallas: View Transitions con React Router (opción viewTransition de Link/navigate), solo fade de 150 ms.
- Menús, diálogos, popovers y toasts: @starting-style + transition-behavior: allow-discrete (fade + escala 98→100 %), para animar la entrada y la salida sin JavaScript. Sin soporte, aparecen sin animación.
- KPI que cuentan hasta su valor (JavaScript con requestAnimationFrame, ≤ 300 ms, solo en la primera carga; con reduced-motion y desde la segunda vez muestran el valor final desde el primer render; un único nodo de texto, sin duplicar el valor solo para lectores: una versión con el número duplicado provocó cierres del renderizador en el WebKit de Playwright).
- Skeleton con brillo suave (gradiente que se desplaza con transform).
- Hover de tarjetas con borde un poco más oscuro (sin levantar); botones con feedback de presión.

Web pública (más expresiva):

- Entre páginas: View Transitions con la integración nativa de Astro (ClientRouter).
- Aparición de todo lo que entra en pantalla (títulos, textos, listas, tarjetas, tablas, FAQ, imágenes): 600 ms, desplazamiento de 20 px y escalonado de 90 ms entre hermanos (--reveal-duration, --reveal-distance y --reveal-step en web/src/styles/global.css; con reduced-motion valen 0). Scroll-driven animations (animation-timeline: view()) dentro de @supports; sin soporte, IntersectionObserver (web/src/scripts/reveal.ts) con la clase html.reveal-fallback, marcada antes del primer pintado. Sin JavaScript el contenido se ve de entrada.
- Héroe con entrada escalonada al cargar, con los mismos tokens.
- Captura del panel con efecto sutil de profundidad (transform en 3D leve ligado al scroll).
- CSP: nada de scripts ni estilos en línea nuevos; el JavaScript va en módulos propios (ver 12).

10.9 Calidad visual (antes de dar por terminada una pantalla)

Grilla de 4 px, sin textos cortados, contraste AA en claro y oscuro, Skeleton en las cargas (nunca spinner de pantalla completa), estados vacíos y de error diseñados, funciona a 375 px, navegable con teclado, sin saltos de layout, y comparada lado a lado con las capturas de referencia.

10.10 Navegadores compatibles

Requisito: Safari 16.4+, Chrome/Edge 111+ y Firefox 128+ (los mínimos de Tailwind 4, que usa @property, color-mix y capas de cascada). Incluye iOS 16.4+ en celulares y tablets de planta. Medidas:
Aviso de navegador no compatible: frontend/public/compat.js, script clásico en ES5 y externo (la CSP no admite scripts en línea), cargado antes que la app. Comprueba color-mix con CSS.supports y @property con CSS.registerProperty; si falta algo, marca <html data-unsupported> (la app no arranca) y muestra una página simple con compat.css, sin Tailwind, explicando qué navegador actualizar. Nunca una pantalla rota o en blanco. El mismo script aplica la clase .dark antes del primer pintado. Con tests unitarios y E2E.
E2E con Playwright en proyectos chromium y webkit (sección 16).
Requisitos publicados en la web pública y en /docs (Parte 6).

Densidad compacta (app, estilo Notion/Linear): `globals.css` de la app fija el body en 14 px y `--text-xs` en 13 px (secundario); el preset y la web pública no cambian. Controles de 36 px (Button md, Input, Combobox), botones pequeños de 32 px, tarjetas con p-4 (móvil) y p-5, separación de 16 px entre bloques (gap-4), filas de tabla de 48 px, sidebar de 260 px. El editor de páginas conserva `prose` (17 px).
Formularios: un único `FormField` (etiqueta arriba, control, ayuda o error debajo) dentro de `FormGrid` (1, 2 o 3 columnas, siempre 1 en móvil; `items-start` para que los controles queden a la misma altura aunque uno tenga ayuda). Seguridad › Email: servidor y puerto; seguridad, usuario y contraseña; remitente, dirección y Reply-To.
