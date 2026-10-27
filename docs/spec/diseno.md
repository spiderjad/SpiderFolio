10. Diseño (moderno y elegante, mismo sistema en app y web)
    10.1 Dirección visual

SaaS moderno, luminoso y limpio, con referencia directa a las capturas de SpiderCitas (panel, página de funciones y documentación) que forman parte del brief. Si SpiderCitas es un producto propio, se pueden reutilizar sus componentes; si no, se toma solo el estilo, nunca su logo, nombre ni textos.

Fondo blanco, superficies gris muy claro, tarjetas blancas con borde de 1 px suave y esquinas generosas (rounded-2xl en tarjetas, rounded-lg en botones e ítems de menú).
Violeta como único color de marca (botones primarios, ítem activo, enlaces, checks, barras de gráficos). Verde, ámbar y rojo solo para estados.
Tipografía sans moderna (Inter) para todo, y una serif de display (Instrument Serif) solo para los grandes títulos de la web y la documentación, que le da el toque elegante.
Etiquetas en mayúsculas con mucho espaciado entre letras (EMPEZAR, GESTIÓN, CITAS HOY) para estructurar sin cajas extra.
Íconos lineales finos (lucide, strokeWidth={1.75}), dentro de cuadrados redondeados con fondo tintado cuando acompañan un título.
Degradado violeta muy tenue (≤ 6 % de opacidad) solo detrás de héroes y cabeceras de docs. Nunca degradados fuertes.
Modo oscuro desde el día 1 (botón luna en web y app).
10.2 Tokens (packages/tailwind-preset)
css
:root {
--background: 0 0% 100%;
--surface: 240 5% 98%; /* fondo del área de contenido de la app _/
--foreground: 240 10% 8%;
--muted: 240 5% 96%;
--muted-foreground: 240 4% 44%;
--border: 240 6% 91%;
--input: 240 6% 88%;
--primary: 262 83% 58%; /_ violeta #7C3AED _/
--primary-foreground: 0 0% 100%;
--primary-soft: 262 100% 97%; /_ fondo del ítem activo, chips _/
--primary-soft-foreground: 263 70% 45%;
--success: 160 84% 39%; /_ #10B981, también 2.ª serie de gráficos _/
--warning: 38 92% 50%; /_ banners de aviso _/
--warning-soft: 48 100% 94%;
--success-foreground: 164 86% 10%; /_ texto sobre success _/
--success-soft: 152 76% 95%; /_ pastilla Vigente _/
--success-soft-foreground: 164 86% 22%;
--warning-foreground: 26 90% 12%; /_ texto del botón ámbar */
--warning-soft-foreground: 22 78% 26%;
--danger: 0 72% 51%;
--danger-foreground: 0 0% 100%;
--danger-soft: 0 86% 97%;
--danger-soft-foreground: 0 70% 35%;
--ring: 262 83% 58%;
--radius: 0.75rem;
}
.dark {
--background: 240 10% 6%;
--surface: 240 8% 8%;
--foreground: 0 0% 96%;
--muted: 240 6% 12%;
--muted-foreground: 240 5% 64%;
--border: 240 5% 16%;
--input: 240 5% 20%;
--primary: 263 85% 68%;
--primary-foreground: 240 10% 6%;
--primary-soft: 263 40% 16%;
--primary-soft-foreground: 263 90% 80%;
--success: 158 64% 52%;
--success-foreground: 160 84% 6%;
--success-soft: 160 40% 12%;
--success-soft-foreground: 156 72% 67%;
--warning: 38 92% 55%;
--warning-foreground: 26 90% 10%;
--warning-soft: 38 50% 14%;
--warning-soft-foreground: 46 97% 65%;
--danger: 0 84% 60%;
--danger-foreground: 240 10% 6%;
--danger-soft: 0 40% 14%;
--danger-soft-foreground: 0 94% 82%;
--ring: 263 85% 68%;
}

La fuente de verdad es packages/tailwind-preset/src/tokens.ts. De ahí se genera tokens.css (npm run tokens:css -w @spiderfolio/tailwind-preset; commiteado, no se edita a mano): las variables de :root y .dark, y un bloque @theme inline que borra la paleta de Tailwind (--color-*: initial) y mapea cada token a --color-<token>: hsl(var(--<token>)). Un test falla si tokens.css quedó desactualizado. Ni la app ni la web copian CSS. Convención: X es el color sólido, X-foreground el texto sobre X, X-soft el fondo tintado (pastillas, banners) y X-soft-foreground el texto sobre X-soft. Un test verifica contraste AA (4,5:1) de cada par texto/fondo en claro y oscuro, y 3:1 para el anillo de foco.

Color de acento por workspace: Workspace.accentColor es null por defecto (= violeta de la marca) y solo se guarda si el cliente elige otro, como #rrggbb en minúsculas. El backend lo valida con HEX_COLOR_RE (#RRGGBB) y lo normaliza con normalizeHex (@spiderfolio/tailwind-preset/accent, sin dependencias de Tailwind). La app calcula las variables con accentTokens(hex) (--primary, --primary-foreground, --primary-soft, --primary-soft-foreground y --ring, distintas para claro y oscuro; primaryForegroundFor elige blanco o casi negro según el contraste) y las aplica con document.documentElement.style.setProperty, volviendo a aplicarlas al cambiar de tema. Nunca con <style> en línea (CSP). Si accentIsLowContrastText(hex) es true, la configuración avisa que los enlaces se leerán mal, sin bloquear.

Preset (Tailwind 4, configurado en CSS): app y web hacen @import "tailwindcss"; y @import "@spiderfolio/tailwind-preset/preset.css";. preset.css no contiene valores de color: importa tw-animate-css y tokens.css, carga @tailwindcss/typography con @plugin, define el modo oscuro por clase (@custom-variant dark (&:where(.dark, .dark *))), las fuentes (--font-sans "Inter Variable", --font-display "Instrument Serif", --font-mono "JetBrains Mono Variable"), los radios derivados de --radius, las sombras shadow-card (casi imperceptible) y shadow-pop (menús y diálogos), los estilos base (bordes, body, prefers-reduced-motion) y el tema de prose con los tokens (@utility prose). La opacidad funciona con la sintaxis normal (bg-primary/50). Prohibido usar colores sueltos de Tailwind (bg-purple-600) en componentes: siempre tokens. La paleta está eliminada, así que esas clases directamente no existen. Tests del preset: compilan preset.css con @tailwindcss/node y verifican las clases de cada token, la ausencia de la paleta, dark por clase, prose, animaciones, fuentes, radios y sombras.

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
Sidebar blanca de 260 px con borde derecho:
Arriba: logo del workspace + nombre, botón para colapsar (<).
Ítems principales sin título de grupo (Inicio, Archivos, Páginas, Aprobaciones, Lecturas) y luego grupos con etiqueta en mayúsculas (CONTENIDO, GESTIÓN, CONFIGURACIÓN).
Ítem: ícono + texto, h-10 px-3 rounded-lg; activo con bg-primary-soft text-primary-soft-foreground font-medium; contadores a la derecha como pastillas pequeñas (neutras o danger-soft si urgen).
Abajo, separado por borde: nombre del workspace en gris, avatar con iniciales sobre fondo primario, nombre, insignia de rol (ADMIN en primary-soft) y botón de cerrar sesión con ícono.
Colapsada: solo íconos con tooltip. En móvil: Sheet desde la izquierda.
Barra superior fina con el título de la sección a la izquierda, fecha en gris y el botón primario contextual a la derecha (+ Nuevo documento).
Contenido sobre bg-surface, max-w-[1400px], padding px-4 sm:px-6 lg:px-8 py-6: título grande + fecha o subtítulo en gris, y luego bloques.
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
Auth (login, registro, recuperar, restablecer, aceptar invitación): pantalla partida; formulario centrado de 400 px a la izquierda con el logo, panel derecho con degradado violeta tenue, título en font-display y tres beneficios con checks violetas. En móvil solo el formulario.
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
