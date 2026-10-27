7. Autenticación y multi-tenancy
7.1 Tokens
Token	Formato	Dónde vive	Duración
Access	JWT HS256 con sub (userId) y sid (sessionId). Sin roles ni workspace	Memoria del frontend (nunca localStorage)	15 min
Refresh	32 bytes aleatorios base64url, opaco	Cookie spiderfolio_rt: HttpOnly, Secure en prod, SameSite=Strict, Path=/api/v1/auth	30 días, rota en cada uso

En la base solo se guarda el SHA-256 del refresh. Cada rotación revoca la fila actual (con replacedAt) y crea otra en la misma familia. Vencimiento: 30 días sin uso, y además un tope absoluto por familia contado desde el login (familyCreatedAt): 90 días por defecto, configurable por workspace en el Módulo 7 (más corto, aplicado en tenantMiddleware contra familyCreatedAt). La rotación nunca extiende el vencimiento más allá del tope. Rol, departamentos y permisos se resuelven en cada request desde la base: un cambio aplica al instante.

En producción app y API comparten origen (https://app.tudominio.com y /api por proxy, sección 15), lo que simplifica cookies y CORS. La cookie se emite sin atributo Domain (solo para app.), así la web pública del dominio raíz nunca la recibe. La web no lee la sesión: "Ir al panel" es solo un enlace a app.tudominio.com.

7.2 Endpoints /api/v1/auth
Método	Ruta	Qué hace
POST	/register	En una transacción: User, Workspace (slug único), los 4 roles de sistema, Membership OWNER. Envía verificación. Devuelve access + cookie
POST	/verify-email	Token de un solo uso, 24 h
POST	/resend-verification	Con rate limit
POST	/login	Crea Session. Devuelve access + cookie + workspaces del usuario
POST	/refresh	Rota el refresh; exige X-Requested-With: spiderfolio y Origin válido
POST	/logout	Revoca la sesión actual y borra la cookie
POST	/logout-all	Revoca todas las sesiones
GET	/me	Usuario + memberships (workspace, rol, capacidades, departamentos)
GET	/sessions · DELETE /sessions/:id	Ver y cerrar sesiones
POST	/forgot-password	Siempre 200. Token de 1 h
POST	/reset-password	Cambia contraseña y revoca todas las sesiones
POST	/change-password	Pide la actual; revoca las demás sesiones

Implementado en backend/src/modules/auth. Las invitaciones (GET /invitations/:token y POST /invitations/:token/accept) ya están en el Módulo 2: el GET (público, con rate limit en Postgres) devuelve empresa, rol y si el email ya tiene cuenta; el POST crea la cuenta (email verificado) y abre sesión, o, con cuenta existente, exige haber iniciado sesión con ella. El token viaja en el fragmento del enlace (/accept-invite#token=…) y el worker lo crea al enviar el email. Errores propios: INVALID_CREDENTIALS (401: login o contraseña actual incorrectos; la app solo refresca la sesión ante UNAUTHENTICATED, nunca ante este código) e INVALID_TOKEN (400: enlace de verificación o restablecimiento usado o vencido). /register responde 201; /refresh y /logout exigen X-Requested-With: spiderfolio y Origin = APP_URL (si no, 403); verify-email, resend-verification, forgot-password, reset-password, change-password, logout y logout-all responden 204. Rate limits sensibles en Postgres: register 10/h por IP; login 5/15 min por IP+email y 50/15 min por IP; forgot-password 3/15 min por IP+email y 20/h por IP; reset-password y verify-email por IP; resend-verification y change-password por usuario.
7.3 Reglas
Registro: Zod (nombre 2–80, email normalizado, contraseña ≥ 10, empresa 2–80). Slug con slugify, sufijos -2, -3 si existe; reservados: app, api, admin, login, register, settings, www, help, status. argon2id (memoryCost 19456, timeCost 2, parallelism 1, la recomendación de OWASP; argon2 usa p=4 por defecto, así que se fija siempre). En cada login exitoso, argon2.needsRehash(hash, parámetros actuales): si es true, se recalcula el hash con los parámetros actuales y se guarda en la misma transacción. Con test. Sin email verificado no se puede invitar ni publicar.
Login: error único "Email o contraseña incorrectos". Email inexistente, contraseña incorrecta y cuenta bloqueada hacen el mismo trabajo (una verificación de argon2: contra el hash real si la contraseña es incorrecta, contra un hash de relleno si el email no existe o la cuenta está bloqueada) y tardan lo mismo; hay un test que cuenta las verificaciones y compara tiempos. Rate limit 5/15 min por IP+email y 50/15 min por IP. Tras 10 fallos, bloqueo de 15 min (auth.lockout); durante el bloqueo, el mismo error aunque la contraseña sea correcta. Miembro SUSPENDED no entra a ese workspace ni aparece en la lista. Un semáforo limita los hashes de argon2 simultáneos (4 por instancia, ~19 MB cada uno). Aviso por email de "nuevo inicio de sesión" si no hubo una sesión con el mismo user agent en 30 días (nunca en el primer login tras el registro).
Emails con token (verificación 24 h, restablecimiento 1 h): el token va en el fragmento del enlace (/verify-email#token=…, /reset-password#token=…), que el navegador no envía al servidor: no queda en logs ni en el Referer; la app lo lee y lo manda por POST. El worker crea el token al enviar e invalida los anteriores sin usar del mismo tipo: solo sirve el último enlace.
Refresh: si llega un token ya rotado hace más de 5 s, revocar toda la familyId y registrar auth.refresh.reuse_detected. Dentro de los 5 s es una carrera entre pestañas: 401 sin revocar (la otra pestaña ya tiene la cookie nueva). Un token revocado por logout da 401. Cualquier 401 de /refresh borra la cookie.
Logout: backend revoca y borra cookie con los mismos atributos; frontend borra el access de memoria, queryClient.clear(), resetea AuthContext, navega a /login con replace: true y avisa a las demás pestañas con BroadcastChannel("spiderfolio-auth").
Arranque del frontend: llamar a /refresh y luego /me, con splash mientras tanto. El cliente HTTP reintenta una sola vez tras un 401 con código UNAUTHENTICATED usando una promesa de refresh compartida. Entre pestañas, el refresh se coordina con navigator.locks.request("spiderfolio-refresh") para que una sola pestaña rote el token a la vez; el margen de 5 s del backend cubre lo que se escape (E2E con recargas simultáneas en dos pestañas). El access token vive en una variable de módulo (frontend/src/auth/token-store.ts); ESLint prohíbe localStorage y sessionStorage en la app salvo la preferencia de tema. Después de un logout (en esta pestaña o en otra), las rutas privadas llevan a /login sin next; una visita nueva sin sesión sí recuerda el destino (?next=, validado con safeNext). Si el navegador restaura la página desde su caché sin sesión (pageshow persisted), se recarga.
7.4 Rutas y middlewares de tenant
Frontend: /app/:workspaceSlug/... · API: /api/v1/w/:workspaceSlug/...
Orden: authMiddleware (JWT HS256 fijo, sesión activa) → tenantMiddleware (workspace + membership activa; si no existe o no es miembro: 404) → requireCapability(...) donde aplique.
req.tenant = { workspaceId, workspaceSlug, membershipId, role, capabilities, departmentIds }. departmentIds son los departamentos de la persona más los de sus ancestros (un subdepartamento hereda del padre); se calculan en cada request y /auth/me los devuelve con su nombre.
req.db = forTenant(client, workspaceId) (backend/src/db/tenant.ts). No es un $extends sino un envoltorio tipado sobre el cliente base o sobre una transacción (así funciona igual dentro de prisma.$transaction, que necesita pg-boss para encolar en la misma transacción). Garantías:
A nivel de tipos solo existen los modelos con tenant y el propio Workspace; no hay modelos globales (User, Session…) ni $queryRaw/$executeRaw. Los datos de creación no piden workspaceId.
Toda lectura, actualización y borrado agrega la condición del workspace al where (en los where únicos, dentro de AND); toda creación inyecta workspaceId y falla si llega otro; ninguna actualización puede cambiar workspaceId (ni el id del Workspace).
Sin escrituras anidadas: las relaciones se escriben con claves foráneas escalares. Las claves foráneas entre tablas con tenant son compuestas (id, workspaceId), así la base impide apuntar a un registro de otro workspace aunque el código falle.
where, select, include, orderBy y _count no pueden recorrer relaciones desde un modelo global (ej. membership → user → memberships expondría otros workspaces); sí leer campos escalares de un modelo global.
AuditLog es append-only (sin update ni delete); Workspace no se crea ni se borra desde forTenant.
Los resultados son promesas comunes: la API fluida de Prisma no está disponible. Transacciones con db.$transaction(fn); no se anidan. El TenantDb que recibe fn tampoco expone SQL en crudo ni el cliente base: para encolar en la misma transacción se pasa ese TenantDb a jobs.enqueue(..., { tx }), que obtiene la transacción base con transactionClientOf (registro privado; solo backend/src/jobs puede importarlo, regla de ESLint) y la usa únicamente para el SQL de pg-boss.
El uso indebido lanza TenantViolation (error de programación → 500). Los metadatos de modelos (db/model-metadata.ts) cubren todos los modelos por tipo, y un test los compara con schema.prisma: un modelo nuevo con workspaceId que forTenant no cubra hace fallar los tests.
SQL en crudo solo en backend/src/db/raw, con workspaceId explícito cuando toca datos de tenant (regla de ESLint). Las rutas (*.routes.ts) no pueden importar el cliente base ni usar deps.prisma (regla de ESLint): usan req.db y servicios. Las rutas de tenant se declaran como datos (backend/src/routes.ts) para que el test de aislamiento las recorra todas.
Nunca aceptar workspaceId desde body o query.
Fase de producción: Row Level Security de Postgres como segunda barrera.
7.5 Test obligatorio

backend/tests/integration/tenant-isolation.test.ts crea workspaces A y B y verifica, para cada endpoint bajo /api/v1/w/, que un usuario de A recibe 404 al leer, listar, editar, mover, descargar o borrar recursos de B. Cada endpoint nuevo se agrega a este test: el test falla si alguna ruta de tenantRoutes no está cubierta. backend/tests/integration/tenant-db.test.ts prueba forTenant contra Postgres real (lecturas, escrituras, upsert, FK compuestas, recorridos, transacciones) y backend/tests/tenant.test.ts cada regla sin base.

7.6 Ingreso con usuario + PIN (lectores de planta)

Para personas sin email corporativo que leen en tablets compartidas. Es una cuenta aparte (User.kind = PIN, sin email ni contraseña: un CHECK de la base lo garantiza) que pertenece a un solo workspace, con plaza de lector y un rol de miembro sin capacidades. La credencial vive en PinLogin (loginName único por workspace, PIN de 6 dígitos con argon2id).

POST /api/v1/auth/pin-login { workspaceSlug, loginName, pin }. Devuelve lo mismo que /login (access + cookie spiderfolio_rt + cuenta). Solo funciona si el workspace activó settings.pinLogin.enabled (apagado por defecto).

- Error único "Usuario o PIN incorrectos." y una verificación de argon2 siempre, si el workspace no existe, el ingreso con PIN está apagado, el usuario no existe, el PIN es incorrecto, la cuenta está bloqueada o suspendida.
- Bloqueo por cuenta: 5 fallos seguidos bloquean 15 minutos; cada bloqueo consecutivo duplica el tiempo (15, 30, 60 min, tope 60). Un ingreso correcto reinicia los contadores; el reset del PIN también desbloquea.
- Rate limit en Postgres: 12 intentos cada 15 min por workspace + usuario (acota el trabajo de argon2) y 200 por IP (amplio: varias tablets de una planta comparten IP). La defensa principal es el bloqueo por cuenta.
- Sesión corta: Session.idleSeconds = settings.pinLogin.idleMinutes × 60 (por defecto 5, de 1 a 30). El refresh vence a ese lapso sin uso y nunca después de 8 horas desde el ingreso (KIOSK_MAX_AGE_MS); el access token dura lo mismo que el lapso (máximo 15 min). La app cierra además por inactividad y tras confirmar una lectura (settings.pinLogin.closeAfterConfirm).
- Reset del PIN: solo con la capacidad members.pin (propietario y administrador). Genera un PIN aleatorio, que se muestra una sola vez, desbloquea la cuenta y revoca todas sus sesiones. Una persona no cambia su propio PIN. PIN débiles (000000, 123456, repetidos, secuencias, patrones de 2 o 3 dígitos) se rechazan.
- Auditoría: pin.create, pin.reset, pin.login.success, pin.login.failure (con el motivo, nunca el PIN) y pin.login.locked.
- No recibe emails ni puede usar /login, /forgot-password ni /change-password; los trabajos de email lo omiten.

Estado: implementados el modelo, el login, la sesión corta y el servicio para crear y resetear (backend). Pendientes: el panel para crear y resetear (members.pin), la pantalla de tablet con teclado, el cierre por inactividad y el cambio rápido de usuario.

Aceptación de Términos y Privacidad
En /register y al aceptar una invitación que crea la cuenta hay una casilla obligatoria y desmarcada por defecto («Acepto los Términos y condiciones y la Política de privacidad», con enlaces a WEB_URL/legal/terminos y WEB_URL/legal/privacidad en pestaña nueva). El backend rechaza el alta sin acceptTerms: true (400) y no crea nada.
Evidencia: una fila TermsAcceptance por aceptación (userId, acceptedAt, ip, userAgent y version = TERMS_VERSION vigente), que nunca se edita. Al cambiar TERMS_VERSION, GET /auth/me y el login devuelven user.terms.required = true a quien no aceptó esa versión (también las cuentas anteriores sin aceptación), y la app muestra una pantalla de aceptación antes de seguir; POST /auth/accept-terms { acceptTerms: true } registra la nueva evidencia. Los usuarios de PIN (tablets, sin email) no aceptan términos.
Casilla aparte y opcional «Quiero recibir novedades de SpiderFolio por email» (desmarcada): User.marketingOptIn y marketingOptInAt, independientes de la aceptación de términos.
