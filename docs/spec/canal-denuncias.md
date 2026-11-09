# Canal de denuncias (sistema interno de información)

Núcleo, abierto y gratis, **apagado por defecto** y activable por empresa, como Seguridad y salud y
Calidad. Spec aprobada por el mantenedor el 09/11/2026, con las cinco propuestas de «Decisiones».

Marco: **Ley 2/2023**, de 20 de febrero, de protección de las personas que informen sobre infracciones
normativas y de lucha contra la corrupción (transpone la Directiva (UE) 2019/1937). Obligatoria para
empresas con **50 o más personas trabajadoras**; en grupos, el sistema puede ser común. En Latinoamérica,
la obligación equivalente de cada país (por ejemplo la Ley Karin en Chile para el acoso laboral);
términos `latam`: «Línea ética».

Lo que resuelve: que **cualquiera** relacionado con la empresa (plantilla, antiguos trabajadores,
candidatos, becarios, contratas, proveedores, socios) pueda comunicar una infracción **por escrito, de
forma anónima o identificándose**, seguir su caso con un código sin tener cuenta, y que la empresa
cumpla los plazos, la confidencialidad y el libro-registro que exige la ley.

## Lo que exige la ley y cómo se cubre

| Exigencia (Ley 2/2023) | En el módulo |
|---|---|
| Canal escrito y/o verbal, también reunión presencial si se pide (art. 7.2) | Formulario público; la gestora registra las comunicaciones verbales y las reuniones (fase 2) |
| Comunicaciones anónimas (art. 7.3) | Sin cuenta, sin IP ni datos del navegador guardados; identificarse es opcional |
| Acuse de recibo en 7 días naturales (art. 9.2.c) | Automático al enviar, en el buzón del informante |
| Respuesta en 3 meses, ampliable 3 más si es complejo (art. 9.2.d) | Plazo calculado, avisos a la gestión, ampliación con motivo |
| Comunicación con el informante y pedirle más información (art. 9.2.b) | Buzón con mensajes en los dos sentidos, con el código de seguimiento |
| Derecho de la persona afectada a ser informada y oída (art. 9.2.f) | Registro de cuándo se le informó y de sus alegaciones |
| Responsable del sistema designado por la dirección (art. 8) | El propietario designa a la persona responsable y a las gestoras |
| Confidencialidad de la identidad (art. 33) | Acceso solo de las gestoras; exclusiones por conflicto de interés; contenido cifrado |
| Libro-registro, no público, máximo 10 años (art. 26) | Registro con número, fechas, estado y resultado; exportable solo por la gestión |
| Supresión de datos: a los 3 meses si no se investiga (art. 32.3) | Tarea automática que borra los datos personales y deja la constancia anonimizada |
| Información clara sobre el canal y los canales externos (art. 25) | Página pública con las garantías, la política y los canales externos (A.A.I. y autonómicos) |
| Prohibición de represalias (art. 36) | Se informa en la página pública; el módulo no expone la identidad a nadie fuera de la gestión |

## Activación

- En **Administración › Seguridad › General**, la tarjeta «Canal de denuncias» (junto a Seguridad y salud y
  Calidad). Solo el **propietario**, con verificación en dos pasos activa y reciente. Se guarda en `Workspace.settings.whistleblowing` = `{ enabled, termsSet? }`.
- Al activar se pide designar **al menos una persona responsable del sistema** (abajo). Sin ella no se
  puede activar: no puede haber un canal que nadie atiende.
- La primera activación crea, una sola vez, dos **documentos controlados en borrador** a partir de una
  plantilla: «Política del sistema interno de información» y «Procedimiento de gestión de
  informaciones», en un espacio que solo ven las gestoras. La ley exige que el órgano de administración
  los apruebe; el flujo de aprobación es el de cualquier documento controlado.
- Desactivar cierra el formulario público (muestra «El canal no está disponible; usa los canales
  externos» con la lista). **Nunca borra casos**: los casos abiertos siguen sus plazos, la gestión los ve
  (su área sigue en la barra) y quien informó sigue entrando a su buzón.
- Auditoría general: `whistleblowing.enable`, `whistleblowing.disable`, `whistleblowing.managers` (quién
  se agregó o quitó). **Nunca** el contenido ni la existencia de un caso concreto.

## Quién hace qué

- **Informante**: cualquiera con el enlace público. No necesita cuenta. Si está dentro de la app, el
  enlace también está en el menú de su usuario («Canal de denuncias»), y la comunicación **no se vincula
  a su cuenta** salvo que elija identificarse.
- **Gestoras** (`WhistleblowingManager`): las personas que reciben y tramitan los casos. Una de ellas es
  la **responsable del sistema** (la persona designada ante la Autoridad Independiente de Protección del
  Informante, A.A.I.). Las designa **solo el propietario**, con 2FA reciente; cada cambio avisa a todas
  las gestoras y queda en la auditoría general.
  - **No es una capacidad de rol.** Nadie la obtiene por ser propietario o administrador, ni puede
    dársela con el editor de roles: así un administrador con `roles.manage` no puede darse acceso a los
    casos. El propietario solo ve los casos si se designa a sí mismo, y eso queda registrado.
  - Las gestoras deben ser miembros activos con plaza completa y tener la verificación en dos pasos
    activa; si la desactivan, pierden el acceso hasta que la vuelvan a activar.
- **Exclusiones por conflicto de interés**: al comunicar, el informante puede marcar gestoras que **no
  deben ver** su caso (por ejemplo, si la comunicación habla de ellas). Una gestora también puede
  apartarse de un caso. Una gestora excluida no lo ve en la lista ni por su id (404), ni recibe avisos.
  Un caso no puede quedar sin ninguna gestora que lo vea: el formulario no deja excluir a todas.
- Todo lo demás de la empresa (administradores, auditoría general, Bian, conector MCP, búsqueda,
  notificaciones a terceros, salas de auditoría, exportaciones generales) **no ve nada** de los casos.

## Anonimato y confidencialidad (decisiones técnicas)

- **Formulario público**: `/canal/:workspaceSlug` (app) y `/api/v1/canal/:workspaceSlug` (API), fuera de
  `/app` y antes de las rutas de empresa, como `/contratas` y `/api/v1/auditor`.
- **Sin rastro del informante**: esas rutas no guardan IP, user-agent ni cabeceras en los logs (el
  logger las redacta para ese prefijo); no ponen cookies hasta que el informante entra a su buzón; no
  cargan nada de terceros. El límite contra abuso por IP vive **solo en memoria** y no se persiste.
- **Usuario con sesión en la app**: la cookie de sesión no se envía a `/api/v1/canal` (su `path` es otro)
  y el backend nunca mira `req.auth` en esas rutas. Identificarse es escribir nombre y contacto a mano.
- **Contenido cifrado** con `secret-box` (AES-256-GCM, workspaceId como dato autenticado): el relato, los
  mensajes, los datos de contacto y los nombres de las personas mencionadas. En claro solo lo necesario
  para listar y avisar: número, categoría, estado, fechas y plazos.
- **Avisos**: a las gestoras, «Hay una comunicación nueva en el canal» o «Un caso vence en N días», sin
  número, categoría ni contenido, ni en la app ni por email.
- **Registro de accesos propio** del módulo (`WhistleblowingAccessLog`): quién abrió o cambió cada caso y
  cuándo. Lo ven las gestoras no excluidas de ese caso. No va a la auditoría general.
- **Archivos adjuntos** (fase 2): en un prefijo propio del almacenamiento, nunca en un espacio (así no
  heredan permisos de carpetas). Antes de subir se avisa de que fotos y documentos pueden llevar datos de
  quien los creó; las imágenes JPG y PNG se guardan **sin metadatos** (EXIF). Solo PDF, JPG y PNG.

## Buzón del informante (seguimiento)

- Al enviar, la pantalla muestra **una sola vez** el **código de seguimiento** (16 caracteres de base32
  de Crockford, ~80 bits) y pide guardarlo. El informante elige además una **contraseña** (mínimo 10
  caracteres); se guarda solo su hash argon2. Código + contraseña abren el buzón.
- El código se guarda solo como hash ligado al caso, como el acceso del portal de contratas, comparado en
  tiempo constante. Perder el código o la contraseña significa no poder entrar: no hay recuperación (no
  sabemos quién es). La pantalla lo explica antes de enviar.
- Entrar: límites por empresa y dirección y por dirección, **solo en memoria** (10 cada 15 minutos y 30
  cada 15 minutos); 10 contraseñas incorrectas seguidas bloquean el buzón 24 horas. El mismo error
  genérico, después del mismo trabajo (argon2), para código inexistente, contraseña incorrecta o buzón
  bloqueado. El buzón funciona aunque el canal esté apagado.
- Sesión: token aleatorio (solo su hash en `WhistleblowingSession`) en una cookie httpOnly,
  SameSite=Strict, `path` `/api/v1/canal/:slug/mailbox`; se crea después de la contraseña (sin fijación),
  termina a los 30 minutos sin uso (cada pedido la extiende) y «Salir» la termina.
- En el buzón: el estado del caso, el acuse de recibo, los mensajes de la gestión y responder (texto y,
  en la fase 2, adjuntos). Nunca se muestra quién de la gestión escribe: firma «La gestión del canal».

## Ciclo de vida del caso

`RECEIVED` → `ADMITTED` / `NOT_ADMITTED` → `INVESTIGATING` → `CLOSED`

1. **Recibido**: se crea con número **DEN-AAAA-NNNN** y el acuse de recibo automático en el buzón
   (cumple los 7 días). Las gestoras reciben el aviso genérico.
2. **Admisión** (plazo orientativo: 10 días hábiles, en `packages/limits`): admitido, o no admitido con
   motivo (no es una infracción del ámbito de la ley, sin fundamento, información ya conocida, etc.).
   El motivo se comunica al informante en el buzón. Si los hechos pueden ser delito: «Remitido al
   Ministerio Fiscal» (art. 9.2.j), con la fecha.
3. **Investigación**: instructora asignada (una gestora), notas internas cifradas, constancia de que se
   informó a la persona afectada y de sus alegaciones, mensajes con el informante.
4. **Cerrado**: resultado (`SUBSTANTIATED` fundado, `NOT_SUBSTANTIATED` no fundado, `PARTIAL`
   parcialmente, `REFERRED` remitido a una autoridad), resumen de medidas y comunicación final al
   informante.

**Plazo de respuesta**: 3 meses desde el acuse; la gestión puede **ampliarlo 3 meses** una vez, con
motivo (especial complejidad), y se informa en el buzón. Avisos a las gestoras a los 30 y 7 días del
vencimiento y al vencer, por el motor de vencimientos (`kind: whistleblowing.deadline`).

## Categorías

Por defecto (editables por la gestión): acoso laboral, acoso sexual o por razón de sexo, discriminación,
seguridad y salud en el trabajo, seguridad alimentaria, medio ambiente, fraude o corrupción, protección de
datos, competencia y mercado, Hacienda y Seguridad Social, conflicto de interés, otra. La categoría no
cambia quién lo ve (todas las gestoras no excluidas).

## Modelo

```prisma
model WhistleblowingManager {
  workspaceId  String
  membershipId String
  responsible  Boolean  @default(false) // la responsable del sistema (una sola por empresa)
  addedById    String
  addedAt      DateTime @default(now())
  @@id([workspaceId, membershipId])
}

model WhistleblowingCase {
  id              String   @id @default(cuid())
  workspaceId     String
  year            Int
  number          Int                  // DEN-AAAA-NNNN
  category        String
  status          WhistleblowingStatus // RECEIVED | ADMITTED | NOT_ADMITTED | INVESTIGATING | CLOSED
  outcome         WhistleblowingOutcome?
  anonymous       Boolean
  bodyEnc         String               // relato, personas mencionadas, contacto (cifrado)
  codeHash        String               // sha256(caseId:código)
  passwordHash    String               // argon2
  failedLogins    Int      @default(0)
  lockedUntil     DateTime?
  receivedAt      DateTime @default(now())
  acknowledgedAt  DateTime
  admittedAt      DateTime?
  dueOn           DateTime             // 3 meses desde el acuse
  extendedAt      DateTime?
  extensionReasonEnc String?
  referredToProsecutorAt DateTime?
  closedAt        DateTime?
  instructorId    String?              // membership de una gestora
  purgeAfter      DateTime?            // cuándo se suprimen sus datos personales
  purgedAt        DateTime?
  @@unique([workspaceId, year, number])
}

model WhistleblowingExclusion { caseId String; membershipId String; @@id([caseId, membershipId]) }
model WhistleblowingMessage  { id, workspaceId, caseId, from (REPORTER | MANAGEMENT), bodyEnc, createdAt }
model WhistleblowingNote     { id, workspaceId, caseId, authorId, bodyEnc, createdAt } // internas
model WhistleblowingAccessLog { id, workspaceId, caseId, membershipId, action, createdAt }
```

Todo pasa por `forTenant`; un caso de otra empresa responde 404, igual que uno del que la gestora está
excluida.

## Conservación y supresión (art. 32)

- **No admitido o sin investigar a los 3 meses** de recibido: se suprimen el relato, los mensajes, las
  notas y los adjuntos; queda solo la constancia anonimizada (número, categoría, fechas, estado), que la
  ley permite para acreditar que el sistema funciona.
- **Cerrado**: se conserva lo necesario para el procedimiento que siga, como máximo el plazo que fije la
  empresa (por defecto 3 años, nunca más de 10, en `packages/limits` y `Workspace.limits`), y después se
  suprime igual.
- Una tarea diaria del worker (`whistleblowing.purge`) aplica `purgeAfter`. Suprimir es irreversible y
  queda en el registro de accesos del módulo como «datos suprimidos».

## Página pública (`/canal/:workspaceSlug`)

- Qué se puede comunicar, quién puede hacerlo, las garantías (confidencialidad, anonimato, prohibición
  de represalias), los plazos y el enlace a la **política** aprobada (el PDF del documento controlado
  vigente, servido como en el portal de contratas).
- **Canales externos**: la A.A.I. y, según la comunidad autónoma de la empresa, su autoridad (por
  ejemplo, la Oficina Antifrau de Catalunya). Texto editable por la gestión.
- **Cartel con QR** para imprimir y colgar en planta y vestuarios (como los QR de documentos), con el
  enlace al formulario. Funciona en el móvil a 375 px, sin cuenta y sin descargar nada.
- La empresa debe enlazarla desde la portada de su web; la guía lo explica.

## API

Pública, sin sesión de la app (`/api/v1/canal/:workspaceSlug`): `GET /` (información de la página y
categorías, o «no disponible»), `POST /reports` (crea el caso, devuelve el código una vez), `POST
/mailbox/login`, `GET /mailbox`, `POST /mailbox/messages`, `POST /mailbox/logout`.

Gestión (`/api/v1/w/:slug/whistleblowing`, solo gestoras no excluidas): lista paginada con cursor y
filtros (estado, categoría, vence antes de), detalle, admitir o no, asignar instructora, notas, mensajes,
ampliar plazo, remitir al Ministerio Fiscal, constancia de información a la persona afectada, cerrar,
apartarse, registro de accesos, exportar el libro-registro (CSV y PDF). Configuración (propietario):
activar, gestoras y responsable, categorías, textos de la página, plazo de conservación.

## Pantallas

- `/canal/:workspaceSlug`: página pública, formulario en un paso (categoría, relato, personas
  implicadas, cuándo y dónde, identificarse o no, gestoras a excluir, contraseña) y, al enviar, el
  código con «Copiar» y «Descargar como texto».
- `/canal/:workspaceSlug/buzon`: entrar con código y contraseña; estado y mensajes.
- Área propia en la barra, **«Canal»** (`/app/:slug/canal`), visible solo para las gestoras: Casos (lista
  con el plazo en color) y la ficha del caso (`/app/:slug/canal/:caseId`: la comunicación, mensajes,
  notas, acciones y el registro de accesos). El libro-registro exportable llega en la fase 2.
- Administración › Seguridad › General (propietario): activar, gestoras y responsable, enlace público,
  canales externos y años de conservación.
- En el menú de cada persona, «Canal de denuncias» abre la página pública en otra pestaña (mientras el
  canal está activo).
- Con spider-ui (`v-*`); la página pública usa el panel claro, sin el marco de la app.

## Fases

1. **Núcleo del canal** (hecha el 09/11/2026, sin probar por el mantenedor): activación y gestoras;
   página pública y formulario; buzón con código y contraseña; casos, estados, plazos, avisos genéricos,
   mensajes, notas, exclusiones; registro de accesos; cifrado. Guía (es y en). Faltan las capturas.
2. **Completo**: adjuntos sin metadatos, comunicaciones verbales y reuniones registradas por la gestión,
   libro-registro exportable, supresión automática, cartel con QR, documentos de política y
   procedimiento al activar, textos `latam`.
3. **Tests de seguridad** al cerrar el módulo (cuando el mantenedor lo pida): anonimato (nada de IP ni
   cuenta en la base ni en los logs), fuerza bruta del buzón, sesión sin fijación, exclusiones (404),
   administradores y propietario sin acceso si no son gestoras, roles que no pueden dar acceso,
   aislamiento entre empresas y tenants, supresión, avisos sin contenido.

## Decisiones (aprobadas el 09/11/2026: las cinco propuestas)

1. **Nombre** en la interfaz: «Canal de denuncias» (el habitual), «Canal ético» o «Sistema interno de
   información» (el de la ley). Propuesta: «Canal de denuncias», con el nombre legal en la página
   pública.
2. **El propietario no ve los casos** salvo que se designe gestora a sí misma. Propuesta: sí, así.
3. **Gestión externa** (una asesoría que lleva el canal, permitido por el art. 6): ¿se invita como
   miembro con plaza completa, o hace falta un tipo de acceso propio que no ocupe plaza? Propuesta: de
   momento, miembro; el acceso propio, si alguien lo pide.
4. **Grupos de empresas** (el art. 11 permite un sistema común): ¿una instalación con varias empresas
   comparte canal? Propuesta: no en la fase 1; un canal por empresa.
5. **Canal verbal por teléfono o mensajería de voz**: la ley lo permite pero exige grabar o transcribir
   con consentimiento. Propuesta: solo el registro manual de la gestión (fase 2), sin grabación en la
   app.
