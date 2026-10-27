12A. Notificaciones, tareas en segundo plano y operación
12A.1 Notificaciones
Modelo Notification (en la app, campana en la barra superior con contador) y preferencias por usuario (NotificationPreference: por tipo, canal app/email, resumen diario o inmediato).
Emails transaccionales con plantilla común (logo, color del workspace, pie legal), en español, versión texto plano incluida: verificación de email · invitación · restablecer contraseña · contraseña cambiada · nuevo inicio de sesión desde otro dispositivo · aprobación pendiente · documento aprobado o rechazado · lectura requerida y recordatorio · revisión de documento por vencer · acceso compartido contigo · te mencionaron · nuevo comentario o respuesta en tus documentos · vencimiento próximo y vencido (al responsable) · código de acceso de sala de auditoría · sala de auditoría por vencer · 80 % y 95 % de un límite · fin de prueba en 3 días · pago fallido · cambio de estado de suscripción · exportación lista · aviso de borrado.
Los emails de seguridad y facturación no se pueden desactivar.
12A.1.1 Notificaciones push web (Módulo 7, pendiente de implementar)
Canal nuevo junto a app y email: notificaciones push del navegador. Requiere una PWA instalable (manifest) y un service worker propio que recibe el push y abre la pantalla relacionada al pulsar. Claves VAPID por entorno (pública y privada en variables de entorno, nunca en el código). Cada dispositivo se registra con su suscripción (PushSubscription: endpoint y claves, ligada a la membresía; se borra al cerrar sesión, al revocarla el navegador o al responder 404/410). Envío desde el worker (cola propia, con reintentos). Contenido mínimo: el push no lleva datos sensibles, solo un título corto y el enlace; el detalle se ve ya dentro de la app con sus permisos.
Preferencias por persona y por tipo de aviso: NotificationPreference pasa a tener tres canales (app, email y push) por tipo, además de inmediato o resumen diario. Los avisos de seguridad y facturación siguen sin poder desactivarse por email. El permiso del navegador se pide con un botón explícito en Mi perfil, nunca al cargar la página. Sin soporte de push (o permiso denegado), cae a app y email.

12A.1.2 Remitente de email propio por empresa (Módulo 7, pendiente de implementar)
Función de los planes Profesional y Empresa (clave de Feature `custom_email_sender`, a agregar en packages/plans). Sin configurar, o si falla, se envía desde el remitente de SpiderFolio. El administrador elige un método en Gestión:
1. Dominio verificado por DNS (recomendado): se da de alta el dominio en el proveedor de email, se muestran los registros SPF y DKIM (y DMARC recomendado) para publicar en el DNS, y la verificación se consulta al proveedor. Hasta estar verificado no se usa. Es el método que mejor entrega y el que no guarda credenciales de la empresa.
2. Microsoft 365 o Google Workspace: el administrador autoriza por OAuth y se envía en nombre de una cuenta de su organización. Solo se piden los permisos de envío; los tokens se guardan cifrados y se pueden revocar desde SpiderFolio.
3. SMTP propio (último recurso): servidor, puerto, seguridad y credenciales, cifradas en reposo (nunca en logs ni se devuelven por la API). Solo conexiones con TLS.
Para los tres: botón "Enviar email de prueba" (a la dirección del administrador) que informa el resultado; respaldo automático al remitente de SpiderFolio si el envío falla (el aviso se entrega igual) y el administrador recibe una notificación con el motivo; auditoría de cada cambio (AuditLog) y límite de envíos de prueba. Los correos de seguridad (restablecer contraseña, verificación) pueden seguir saliendo siempre del remitente de SpiderFolio.

12A.2 Tareas en segundo plano

Cola pg-boss (sobre el mismo Postgres, sin Redis). Contenedor worker separado de la API en producción. Tareas con reintentos y registro:

Tarea	Frecuencia
Envío de emails	Al momento
Generar exportación ZIP	Al momento
Purgar papelera (> 30 días) y objetos huérfanos en S3	Diaria
Conciliar storageUsedBytes con el bucket	Diaria
Vencer accesos temporales e invitaciones	Cada hora
Recordatorios de lectura y revisiones por vencer	Diaria, 8:00 hora del workspace
Avisos de límites y de fin de prueba	Diaria
Transiciones de estado de suscripción y borrados programados	Diaria
Recortar auditoría según la retención que fije la empresa	Semanal
Limpiar reservas de subida vencidas	Cada hora
Avisos de vencimientos	Diaria, 8:00 hora del workspace
Cerrar salas de auditoría vencidas	Cada hora
Generar PDF controlado al publicar	Al momento
Descomprimir importaciones ZIP	Al momento

Cada workspace tiene zona horaria e idioma propios (en settings), usados por los recordatorios y las fechas.
Integración (backend/src/jobs): pg-boss en el esquema pgboss del mismo Postgres, fuera de Prisma. La API solo encola (enqueue valida el payload con Zod); el worker (backend/src/worker.ts, otro proceso y otro contenedor) procesa y programa. Encolar dentro de una transacción: enqueue(..., { tx }) con el TenantDb de db.$transaction (servicios de tenant) o con la transacción de prisma.$transaction (servicios de modelos globales, como auth); usa el adaptador fromPrisma de pg-boss y, si la transacción se revierte, el job no existe. Los payloads nunca llevan secretos ni datos personales: para un email va { kind, userId } y el worker busca el resto; los emails con token (verificación, restablecimiento) crean el token en el worker al enviar, así ningún token en claro queda guardado en la cola. Reintentos con backoff y cola de fallidos (email-failed) que registra y avisa a Sentry.
Horarios: las limpiezas (rate limit, sesiones y tokens vencidos) corren en UTC, una sola vez por tick en todo el clúster. Para los avisos "a las 8:00 hora del workspace": un único job horario en UTC que selecciona los workspaces donde en ese momento son las 8:00 según settings.timezone. Nunca un cron por workspace.
Worker: email-send se procesa en lotes de hasta 10 con resultado por job (un email que falla se reintenta solo, sin reenviar el resto), en modo ráfaga mientras haya cola, y con LISTEN/NOTIFY (useListenNotify en el worker, notify en la cola) para que el worker despierte apenas se encola. Por defecto pg-boss toma 1 job cada 2 s (~30 emails por minuto); eso no se usa.
Mailer: nodemailer por SMTP (Mailpit en desarrollo). Plantilla común con estilos en línea, todo lo interpolado se escapa y siempre hay versión de texto plano.

12A.3 Backoffice de la instalación
Ruta /internal en la app, solo para usuarios con User.isStaff = true (quien administra la instalación), con 2FA obligatoria y, pendiente, restringida por IP.
Ve las empresas de la instalación con su uso, sus límites y si tienen licencia de plugins.
No puede ver contenido de documentos ni archivos ni hacerse pasar por un usuario.
12A.4 Observabilidad y entornos
Errores de backend y frontend en Sentry (o GlitchTip autoalojado), sin datos personales ni contenido en los eventos. Sentry 11 recolecta por defecto usuario, cookies, cabeceras, cuerpos HTTP y query params: se apaga todo con dataCollection (backend/src/lib/sentry.ts y frontend/src/lib/sentry.ts). Solo se inicializa si hay SENTRY_DSN (en la app, VITE_SENTRY_DSN; sin DSN el SDK ni se descarga). En la app, además: sin Replay ni trazas, las URLs viajan sin query ni fragmento (ahí van los tokens) y los breadcrumbs de consola e interfaz se descartan.
La web pública no tiene analítica ni cookies (la política de privacidad lo declara): si algún día se agrega analítica, tiene que ser sin cookies (Plausible o Umami) y actualizar las páginas legales.
Monitor externo de disponibilidad para tudominio.com, app. y /api/health.
Entornos: local y la instalación de cada empresa (docs/instalacion/). Para probar una actualización conviene una copia aparte antes de producción.
Bucket de R2 con versionado de objetos activado (protege contra borrados por error durante 30 días).
