# Salas de auditoría

Núcleo, gratis (9C.9 de docs/spec/adopcion.md; plan aprobado el 03/11/2026). Reemplaza al esqueleto del plugin
`audit-rooms`, que se borra. Un espacio temporal de solo lectura para un auditor externo: sin cuenta, sin plaza
y sin ver nada más de la empresa.

## Qué guarda

- **AuditRoom**: nombre, email del auditor, vencimiento (obligatorio, hasta 30 días), si permite descargar,
  quién la creó, revocada (fecha y quién).
- **AuditRoomItem**: un nodo (documento o carpeta), un espacio o un informe con sus parámetros:
  - `readings`: cumplimiento de lecturas de un documento controlado;
  - `approvals`: historial de aprobaciones y versiones de un documento controlado;
  - `form-records`: registros de un formulario entre dos fechas;
  - `training`: constancias de un curso (formación presencial y por lectura);
  - `ppe`: entregas de EPIs entre dos fechas;
  - `audit-log`: registro de auditoría filtrado (fechas, acción, persona).
- Nunca accidentes ni aptitud (datos de salud): no hay tipo de informe para ellos.
- **AuditRoomCode**: código de 6 dígitos de un solo uso (hash), 10 minutos, 5 intentos.
- **AuditRoomSession**: sesión del auditor (cookie httpOnly propia, hash del token), hasta 8 horas y nunca
  más que la sala.
- **AuditRoomAccess**: cada entrada, vista y descarga: fecha, IP, navegador, qué.

## Quién

- Crea, revoca, reenvía el enlace y ve los accesos: quien tiene `audit.share`, con las salas que creó (el
  propietario ve todas).
- Solo agrega lo que ve: un nodo o espacio con nivel VIEW; cada informe con la capacidad que ya pide hoy
  (`audit.view` el registro de auditoría, cumplimiento y aprobaciones las de documentos controlados, registros
  el acceso al formulario, formación y EPIs `safety.manage`).
- Auditoría: `audit-room.create`, `.revoke`, `.item.add`, `.item.remove`, `.resend`; los accesos del auditor van
  a AuditRoomAccess (y su entrada, también a la auditoría de la empresa).

## El auditor

1. Recibe un email con el enlace `/auditoria/:roomId` (y el nombre de la empresa y de la sala).
2. Pide el código: llega a ese email (rate limit por sala e IP).
3. Con el código entra: ve la lista de lo compartido y lo abre.

Rutas propias `/api/v1/auditor/:roomId/…`, fuera de las de la empresa; nunca usan la sesión de un miembro.
Cada consulta va por `forTenant(room.workspaceId)` y solo a lo que la sala tiene (una carpeta o un espacio
incluye lo que tiene adentro al momento de verlo, sin la papelera). Vencida o revocada, la sesión deja de
valer en la siguiente petición. La primera entrada avisa en la campana a quien creó la sala.

## Lo que ve: PDF con marca de agua

Todo se entrega como PDF con «Copia para auditoría · [email] · [fecha]» en cada página (pdf-lib, como la copia
no controlada): páginas → Gotenberg; PDF → se estampa; Word, Excel y similares → LibreOffice de Gotenberg y se
estampa; imágenes → dentro de un PDF. Los documentos controlados, su versión vigente. Los informes, HTML →
Gotenberg. Sin «permitir descargar», se ve en pantalla sin botón de descarga (lo que se ve siempre se puede
capturar: la marca de agua es la protección).

## Pantallas

- **Administración › Salas de auditoría**: lista (estado: abierta, vencida, revocada), crear, detalle con lo
  compartido, agregar y quitar, accesos, revocar, reenviar el enlace.
- **«Agregar a una sala de auditoría»** en el menú «⋯» del explorador.
- **/auditoria/:roomId**: pedir el código, ingresarlo, la sala y el visor.

## Fases

1. Datos, API de administración, entrada del auditor con código, PDF con marca de agua, registro de accesos.
2. Pantallas, guías es/en y capturas. Se borra el esqueleto del plugin y su precio; la web lo presenta como
   función gratis.

Tests al final (antes de publicar): aislamiento entre empresas, el auditor no llega a nada fuera de la sala (otro
nodo, otra empresa, datos de salud, rutas de miembros), vencimiento, revocación y código de un solo uso
(reutilizado, vencido, demasiados intentos).
