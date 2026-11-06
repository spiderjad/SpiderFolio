# Módulo de Calidad alimentaria (plugin de pago) — notas

Estado: idea anotada el 07/11/2026. No implementar hasta que quien mantiene el proyecto lo pida. Paso
siguiente: escribir `docs/spec/calidad.md` y revisarlo antes de tocar código.

## Decisiones

- **Plugin comercial**, como la CAE: entra por los puntos de extensión (docs/spec/plugins.md), se activa
  por empresa con una licencia que lo incluya y el núcleo nunca depende de él. Id propuesto:
  `food-quality` (sumarlo a `COMMERCIAL_PLUGIN_IDS` en `@spiderfolio/plugin-sdk` cuando se empiece).
- Pensado primero para cárnicas. Normas que se auditan hoy: **IFS Food versión 8** (obligatoria desde el
  01/01/2024) y **BRCGS Food Safety Issue 9** (publicada el 01/08/2022; la Issue 10 todavía no salió).
  Además, lo que revisa la inspección sanitaria oficial.
- Reutiliza lo que ya hay: documentos controlados, formularios periódicos (con `min`/`max` y no
  conformidad, aviso `form_nonconforming`), vencimientos, QR, salas de auditoría, Bian y el patrón de
  seguridad y salud (incidente → medidas con responsable, fecha y cierre).

## Los 14 bloques

1. **APPCC (HACCP)**: diagrama de flujo por familia (curados, cocidos, frescos); análisis de peligros
   biológicos, químicos, físicos y alérgenos con árbol de decisión; PCC con límite crítico, frecuencia,
   responsable, acción correctiva y verificación (núcleo en cocción, detector de metales, nitritos, pH y
   aw al salir del secadero, enfriamiento). Cada versión del plan es un documento controlado con revisión
   anual y aprobación del equipo APPCC.
2. **Registros de vigilancia** (formularios periódicos): recepción de materia prima (temperatura, estado,
   lote de origen, registro sanitario del matadero), cámaras, curva de secaderos, cocción, enfriamiento,
   detector de metales con piezas patrón. **Un valor fuera de límite abre sola una no conformidad.** QR en
   cada PCC que abre el registro y la instrucción vigente.
3. **Prerrequisitos**: limpieza y desinfección (plan, verificación visual y ATP, fichas de seguridad);
   plagas (empresa externa, mapa de cebos, informes, certificados con vencimiento); agua (cloro diario,
   analíticas, legionela); mantenimiento y calibración (termómetros, balanzas, sondas, detectores, con
   vencimientos); vidrio y plástico duro, cuerpos extraños; SANDACH (Reglamento 1069/2009: retiradas,
   gestor, documentos de traslado).
4. **Trazabilidad**: materia prima (canal, matadero, país) → lote intermedio → producto terminado →
   cliente; búsqueda hacia atrás y hacia adelante; simulacro anual de retirada cronometrado. Los lotes ya
   están en SAP y ADA MES: leerlos con un conector, no volver a cargarlos.
5. **No conformidades y CAPA**: origen (interno, auditoría, reclamación, proveedor, PCC fuera de límite),
   gravedad, causa (5 porqués o Ishikawa), acciones con responsable y fecha, verificación de eficacia.
   Producto no conforme: bloqueo del lote, decisión (reproceso, otro destino, SANDACH), liberación firmada.
6. **Reclamaciones** de clientes y consumidores: registro, respuesta en plazo, vínculo con una CAPA;
   indicador por millón de unidades, por cliente y por producto.
7. **Retirada y crisis**: equipo, contactos (autoridad sanitaria, clientes, aseguradora), plantillas de
   comunicación, árbol de decisión y registro de simulacros.
8. **Proveedores**: homologación con cuestionario, fichas técnicas, certificados IFS/BRC con aviso de
   vencimiento, evaluación anual; materias de riesgo (tripas, especias con alérgenos como mostaza o apio,
   aditivos); vulnerabilidad al fraude y food defense (IFS 4.21).
9. **Especificaciones y etiquetado**: ficha técnica del producto (receta, aditivos, alérgenos, nutricional,
   vida útil); estudios de vida útil con Listeria en listos para consumo (Reglamento 2073/2005); circuito
   de aprobación de etiquetas contra el Reglamento 1169/2011 y la ficha vigente.
10. **Plan analítico**: muestreo de producto, superficies y ambiente (Listeria ambiental en zonas de listo
    para consumo); informes del laboratorio externo, criterios por reglamento, tendencias y alertas.
11. **Auditorías**: programa anual de internas que cubra toda la norma; externas (IFS/BRC, clientes,
    inspección oficial); cada hallazgo genera una CAPA; el auditor ve sus evidencias en una sala.
12. **Cultura de seguridad alimentaria**: plan anual, encuestas e indicadores (IFS 8 y BRC 9 la exigen).
13. **Gestión de cambios**: receta, línea, equipo o proveedor nuevos pasan por revisión del APPCC antes de
    aprobarse.
14. **Panel de indicadores**: NC y CAPA abiertas o vencidas, registros sin completar, valores fuera de
    límite, microbiología, reclamaciones, proveedores con certificado vencido.

## Orden propuesto

1. CAPA (bloque 5), con apertura automática desde un registro fuera de límite. Es la columna: auditorías,
   reclamaciones, proveedores y el panel terminan en una CAPA.
2. APPCC y registros de los PCC (1 y 2) como plantilla de cárnica sobre documentos controlados,
   formularios y QR.
3. Hallazgos de auditoría → CAPA (11), sobre las salas de auditoría.
4. Proveedores (8) con vencimientos.
5. Panel (14).
6. Reclamaciones, retirada, prerrequisitos, especificaciones, plan analítico, cultura y cambios.
7. Trazabilidad (4) al final: depende del conector con SAP y ADA MES.
