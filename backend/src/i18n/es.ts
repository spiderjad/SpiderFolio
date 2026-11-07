// Textos del backend en español neutro (tuteo, sin voseo), centralizados para i18n (CLAUDE.md, sección 17).
// El contrato con la app es el código de error; el mensaje es para personas.

export const errorMessages = {
  VALIDATION_ERROR: "Los datos enviados no son válidos.",
  BAD_REQUEST: "La solicitud no es válida.",
  UNAUTHENTICATED: "Tu sesión no es válida o venció. Inicia sesión de nuevo.",
  INVALID_CREDENTIALS: "Email o contraseña incorrectos.",
  INVALID_TOKEN: "El enlace no es válido o ya venció. Pide uno nuevo.",
  FORBIDDEN: "No tienes permiso para hacer esto.",
  MFA_INVALID_CODE: "El código no es correcto o ya se usó.",
  MFA_SETUP_REQUIRED:
    "Tu empresa exige la verificación en dos pasos. Actívala en tu perfil para seguir.",
  DIRECTORY_SIGN_IN_REQUIRED:
    "En esta empresa se entra con la cuenta corporativa. Cierra sesión y vuelve a entrar con ella.",
  MFA_RECENT_REQUIRED: "Para hacer esto, confirma de nuevo el código de tu app de autenticación.",
  LIMIT_REACHED: "Se alcanzó un límite que fijó tu empresa. Un administrador puede cambiarlo.",
  NOT_FOUND: "No encontramos lo que buscas.",
  CONFLICT: "La operación entra en conflicto con datos existentes.",
  PAYLOAD_TOO_LARGE: "La solicitud es demasiado grande.",
  RATE_LIMITED: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  UNAVAILABLE: "El servicio no está disponible en este momento.",
  INTERNAL: "Ocurrió un error inesperado. Ya lo estamos revisando.",
} as const;

/** Mensajes puntuales que reemplazan al genérico de su código. */
export const specificErrorMessages = {
  emailTaken:
    "No pudimos crear la cuenta con ese email. Si ya tienes una, inicia sesión o recupera tu contraseña.",
} as const;

export const emailTexts = {
  footer:
    "Recibiste este email porque tienes una cuenta en SpiderFolio. Si no reconoces esta actividad, responde a este mensaje.",
  linkFallback: "Si el botón no funciona, copia este enlace en tu navegador:",
  /** Quien hizo algo, cuando ya no se encuentra su nombre. */
  someone: "Alguien",
  /** Cuando no se sabe el nombre de la empresa. */
  yourCompany: "tu empresa",
  /** Une navegador y sistema: «Chrome en Windows». */
  deviceJoin: " en ",
  verifyEmail: {
    subject: "Confirma tu email en SpiderFolio",
    title: "Confirma tu email",
    greeting: (name: string) => `Hola, ${name}:`,
    body: "Para terminar de activar tu cuenta, confirma que este email es tuyo.",
    action: "Confirmar email",
    expiry:
      "El enlace vence en 24 horas. Si no creaste una cuenta en SpiderFolio, ignora este email.",
  },
  resetPassword: {
    subject: "Restablece tu contraseña de SpiderFolio",
    title: "Restablece tu contraseña",
    greeting: (name: string) => `Hola, ${name}:`,
    body: "Recibimos un pedido para restablecer la contraseña de tu cuenta.",
    action: "Elegir una contraseña nueva",
    expiry:
      "El enlace vence en 1 hora y sirve una sola vez. Si no lo pediste, ignora este email: tu contraseña no cambia.",
  },
  newLogin: {
    subject: "Nuevo inicio de sesión en SpiderFolio",
    title: "Nuevo inicio de sesión",
    greeting: (name: string) => `Hola, ${name}:`,
    body: (device: string, when: string) =>
      `Se inició sesión en tu cuenta desde un dispositivo nuevo (${device}) el ${when} (UTC).`,
    warning:
      "Si fuiste tú, no tienes que hacer nada. Si no, cambia tu contraseña y cierra las demás sesiones desde tu perfil.",
    unknownDevice: "dispositivo desconocido",
  },
  mfaEnabled: {
    subject: "Activaste la verificación en dos pasos",
    title: "Verificación en dos pasos activada",
    greeting: (name: string) => `Hola, ${name}:`,
    body: "Desde ahora, al iniciar sesión en SpiderFolio te pediremos también el código de tu app de autenticación. Guarda tus códigos de recuperación en un lugar seguro.",
    warning:
      "Si no fuiste tú, cambia tu contraseña ahora mismo y avísanos respondiendo a este email.",
  },
  mfaDisabled: {
    subject: "Desactivaste la verificación en dos pasos",
    title: "Verificación en dos pasos desactivada",
    greeting: (name: string) => `Hola, ${name}:`,
    body: "Tu cuenta ya no pide el código de la app de autenticación al iniciar sesión. Tus códigos de recuperación y los dispositivos de confianza dejaron de valer.",
    warning:
      "Si no fuiste tú, cambia tu contraseña ahora mismo, vuelve a activarla y avísanos respondiendo a este email.",
  },
  mfaReset: {
    subject: "Reiniciaron tu verificación en dos pasos",
    title: "Tu verificación en dos pasos se reinició",
    greeting: (name: string) => `Hola, ${name}:`,
    body: (workspace: string) =>
      `Un administrador de ${workspace} reinició la verificación en dos pasos de tu cuenta y cerramos tus sesiones. La próxima vez que entres podrás volver a configurarla con tu app de autenticación.`,
    warning: "Si no lo pediste, avisa a tu administrador y cambia tu contraseña ahora mismo.",
  },
  passwordChanged: {
    subject: "Tu contraseña de SpiderFolio cambió",
    title: "Cambiaste tu contraseña",
    greeting: (name: string) => `Hola, ${name}:`,
    body: "La contraseña de tu cuenta se cambió correctamente y cerramos tus otras sesiones.",
    warning:
      "Si no fuiste tú, restablece tu contraseña ahora mismo y avísanos respondiendo a este email.",
  },
} as const;

/** Reglas de roles y capacidades (9.1 y 9.2). */
export const roleMessages = {
  baseNotAllowed: "No puedes crear un rol con ese nivel base.",
  guestWithCapabilities: "Un rol de invitado no puede tener capacidades administrativas.",
  capabilitiesNotHeld: (missing: readonly string[]) =>
    `No puedes dar capacidades que tú no tienes: ${missing.join(", ")}.`,
  systemRole: "Los roles de sistema no se pueden modificar ni borrar.",
  roleAboveYou: "Este rol da más poder del que tienes: no puedes modificarlo ni borrarlo.",
  nameTaken: "Ya existe un rol con ese nombre.",
  inUse: (members: number, invitations: number) =>
    `Este rol está en uso (miembros: ${String(members)}, invitaciones pendientes: ${String(invitations)}). Cámbialo antes de borrarlo.`,
  readersCannotAdminister:
    "Hay lectores con este rol y un lector no puede tener capacidades administrativas.",
  guestsNeedReaderSeat:
    "Hay miembros con plaza completa con este rol y un invitado siempre es lector.",
} as const;

/** Departamentos (9.3). */
export const positionMessages = {
  nameTaken: "Ya existe un puesto con ese nombre.",
} as const;

export const departmentMessages = {
  nameTaken: "Ya existe un departamento con ese nombre.",
  parentCycle:
    "Un departamento no puede quedar dentro de sí mismo ni de uno de sus subdepartamentos.",
  managerNotActive: "El responsable tiene que ser un miembro activo del workspace.",
  moveToSame: "La persona ya está en ese departamento.",
  leaderCannotTouch:
    "Como jefe de departamento no puedes gestionar a personas con un rol igual o superior al tuyo, ni a ti mismo.",
  guestsHaveNoDepartments:
    "Un invitado externo solo ve lo que se le comparte explícitamente: no entra a departamentos.",
} as const;

export const invitationMessages = {
  verifyEmailFirst: "Confirma tu email para poder invitar a tu equipo.",
  ownerRole: "No se puede invitar con el rol de propietario: la propiedad se transfiere.",
  roleAboveYou: "No puedes invitar con un rol que da más poder del que tienes.",
  guestMustBeReader: "Un invitado externo siempre ocupa plaza de lector.",
  leaderOwnAreaOnly: "Solo puedes invitar a los departamentos que lideras y sus subáreas.",
  readerCannotAdminister: "Un lector no puede tener un rol con capacidades administrativas.",
  guestsHaveNoDepartments:
    "Un invitado externo solo ve lo que se le comparte explícitamente: no entra a departamentos.",
  domainNotAllowed: "Estos emails no son de un dominio permitido para invitar.",
  alreadyHasAccount: "Este email ya tiene una cuenta: inicia sesión y abre de nuevo el enlace.",
  wrongAccount: "Esta invitación es para otro email. Inicia sesión con la cuenta invitada.",
  detailsRequired: "Escribe tu nombre y elige una contraseña para crear tu cuenta.",
  termsRequired: "Debes aceptar los Términos y condiciones y la Política de privacidad.",
  notPending: "La invitación ya no está disponible.",
} as const;

export const invitationEmailTexts = {
  subject: (workspace: string) => `Te invitaron a ${workspace}`,
  title: (workspace: string) => `Te invitaron a ${workspace}`,
  greeting: "Hola:",
  someone: "Alguien de tu equipo",
  body: (inviter: string, workspace: string, role: string) =>
    `${inviter} te invitó a ${workspace} con el rol de ${role}.`,
  action: "Aceptar invitación",
  expiry: "El enlace vence en 7 días. Si no esperabas esta invitación, ignora este email.",
} as const;

/** Te mencionaron con @ en una página o en un comentario. */
export const mentionEmailTexts = {
  subject: (who: string) => `${who} te mencionó`,
  title: (who: string) => `${who} te mencionó`,
  greeting: (name: string) => `Hola ${name}:`,
  inPage: (who: string, page: string) => `${who} te mencionó en el texto de «${page}».`,
  inComment: (who: string, page: string) => `${who} te mencionó en un comentario de «${page}».`,
  action: "Abrir la página",
  footnote: "Recibes este aviso porque tienes acceso a la página.",
} as const;

/** Te dieron acceso directo a algo (espacio, carpeta, archivo o página). */
export const sharedEmailTexts = {
  subject: (who: string, what: string) => `${who} compartió «${what}» contigo`,
  title: (who: string) => `${who} compartió algo contigo`,
  greeting: (name: string) => `Hola ${name}:`,
  body: (who: string, what: string, level: string) =>
    `${who} te dio acceso a «${what}» con permiso para ${level}.`,
  levels: { VIEW: "ver", COMMENT: "comentar", EDIT: "editar", MANAGE: "gestionar" },
  action: "Abrir",
  footnote: "Recibes este aviso porque ahora tienes acceso.",
} as const;

/** Avisos de documentos controlados (aprobaciones). */
export const documentNoticeTexts = {
  greeting: (name: string) => `Hola ${name}:`,
  approval_pending: {
    subject: (what: string) => `Aprobación pendiente: ${what}`,
    title: "Tienes un documento por aprobar",
    body: (who: string, what: string, code: string, version: number) =>
      `${who} te pidió aprobar «${what}» (${code}, versión ${String(version)}).`,
    action: "Revisar el documento",
  },
  approval_approved: {
    subject: (what: string) => `Aprobado: ${what}`,
    title: "Tu documento fue aprobado",
    body: (what: string, code: string, version: number) =>
      `«${what}» (${code}, versión ${String(version)}) fue aprobado y ya se puede publicar.`,
    action: "Abrir el documento",
  },
  approval_rejected: {
    subject: (what: string) => `Rechazado: ${what}`,
    title: "Tu documento fue rechazado",
    body: (what: string, code: string, version: number) =>
      `«${what}» (${code}, versión ${String(version)}) fue rechazado y esa versión se descartó. Revisa el motivo y crea una nueva.`,
    action: "Abrir el documento",
  },
  approval_changes: {
    subject: (what: string) => `Piden cambios: ${what}`,
    title: "Piden cambios en tu documento",
    body: (who: string, what: string, code: string, version: number) =>
      `${who} pidió cambios en «${what}» (${code}, versión ${String(version)}). Vuelve a ser un borrador: revisa los comentarios y envíalo otra vez.`,
    action: "Abrir el documento",
  },
  reading_required: {
    subject: (what: string) => `Lectura requerida: ${what}`,
    title: "Tienes un documento por leer",
    body: (who: string, what: string, code: string, version: number, due: string | null) =>
      `${who} te pidió leer «${what}» (${code}, versión ${String(version)}).${due === null ? "" : ` Plazo: ${due}.`}`,
    action: "Leer y confirmar",
  },
  reading_reminder: {
    subject: (what: string) => `Recordatorio de lectura: ${what}`,
    title: "Te falta leer un documento",
    body: (_who: string, what: string, code: string, version: number, due: string | null) =>
      `Todavía no confirmaste la lectura de «${what}» (${code}, versión ${String(version)}).${due === null ? "" : ` Plazo: ${due}.`}`,
    action: "Leer y confirmar",
  },
  reading_overdue_leader: {
    subject: (what: string) => `Lectura vencida en tu área: ${what}`,
    title: "Una lectura de tu área está vencida",
    body: (who: string, what: string, code: string, version: number, due: string | null) =>
      `${who} no confirmó la lectura de «${what}» (${code}, versión ${String(version)}).${due === null ? "" : ` Venció el ${due}.`}`,
    action: "Ver el documento",
  },
  footnote: "Recibes este aviso porque tienes acceso al documento.",
} as const;

/** Cambio de email pedido por la propia persona. */
export const emailChangeTexts = {
  confirm: {
    subject: "Confirma tu nuevo email",
    title: "Confirma tu nuevo email",
    greeting: (name: string) => `Hola ${name}:`,
    body: "Pediste usar esta dirección como el email de tu cuenta. Confírmala para que reemplace a la anterior.",
    action: "Confirmar el email",
    expiry:
      "El enlace vence en 24 horas. Si no lo pediste, ignora este email: tu cuenta sigue igual.",
  },
  notice: {
    subject: "Pidieron cambiar el email de tu cuenta",
    title: "Pidieron cambiar el email de tu cuenta",
    greeting: (name: string) => `Hola ${name}:`,
    body: (next: string) =>
      `Se pidió cambiar el email de tu cuenta a ${next}. No cambia hasta que se confirme desde esa dirección.`,
    warning: "Si no fuiste tú, cambia tu contraseña ahora.",
  },
} as const;

/** Exportación de un ZIP grande (9.3): el aviso con el enlace temporal. */
export const exportEmailTexts = {
  ready: {
    subject: "Tu ZIP está listo",
    title: "Tu ZIP está listo",
    greeting: (name: string) => `Hola ${name}:`,
    body: (fileName: string, size: string) =>
      `Ya puedes descargar ${fileName} (${size}). Lo pediste desde Archivos.`,
    action: "Descargar el ZIP",
    expiry: (days: number) =>
      `El enlace funciona durante ${String(days)} días y solo si sigues siendo parte del equipo.`,
  },
  failed: {
    subject: "No pudimos generar tu ZIP",
    title: "No pudimos generar tu ZIP",
    greeting: (name: string) => `Hola ${name}:`,
    body: (fileName: string, reason: string) => `No se pudo generar ${fileName}. ${reason}`,
    retry: "Puedes pedirlo de nuevo desde Archivos, quizá por partes.",
  },
} as const;

/** Miembros (9.3). */
/** Encabezados y valores del CSV de miembros exportado. */
export const memberExportLabels = {
  name: "Nombre",
  email: "Email",
  loginName: "Usuario",
  jobTitle: "Cargo",
  role: "Rol",
  seat: "Plaza",
  status: "Estado",
  departments: "Departamentos",
  lastSeen: "Último acceso",
  createdAt: "Alta",
  seats: { FULL: "Completa", READER: "Lector" },
  statuses: { ACTIVE: "Activo", SUSPENDED: "Suspendido" },
} as const;

/** Usuario + PIN de lectores de planta (7.6). */
export const pinMessages = {
  invalidCredentials: "Usuario o PIN incorrectos.",
  roleNotAllowed:
    "Una persona con PIN solo puede tener un rol de miembro sin capacidades administrativas.",
  weakPin: "Ese PIN es demasiado fácil de adivinar. Elige otro o genera uno.",
  loginNameTaken: "Ya hay una persona con ese usuario en este workspace.",
  loginNameInvalid:
    "El usuario lleva de 3 a 32 letras minúsculas, números, punto, guion o guion bajo.",
  notPinMember: "Esta persona no entra con PIN.",
} as const;

export const memberMessages = {
  identityShared:
    "Esta persona tiene cuenta en otras empresas: solo ella puede cambiar su nombre o su email.",
  emailAlreadyConfirmed: "Ya confirmó su email: lo cambia ella misma desde su cuenta.",
  pinHasNoEmail: "Quien entra con usuario y PIN no tiene email.",
  emailTaken: "Ya hay una cuenta con ese email.",
  targetAboveYou: "No puedes gestionar a una persona con un rol por encima del tuyo.",
  ownerRoleNotAssignable:
    "El rol de propietario no se asigna desde acá: la propiedad se transfiere desde la configuración.",
  lastOwner: "El workspace tiene que tener al menos un propietario activo.",
  cannotActOnSelf: "No puedes hacer esto sobre tu propia cuenta.",
  guestSeatMustBeReader: "Un invitado externo siempre ocupa plaza de lector.",
  administrativeSeatMustBeFull:
    "Un rol con capacidades administrativas necesita una plaza de usuario completo.",
  readerCannotAdminister: "Un lector no puede tener capacidades administrativas.",
  guestsHaveNoDepartments:
    "Un invitado externo solo ve lo que se le comparte explícitamente: no entra a departamentos.",
  transferTargetInvalid:
    "La persona a quien se transfiere el contenido tiene que ser un miembro activo distinto.",
  alreadySuspended: "La persona ya está suspendida.",
  notSuspended: "La persona no está suspendida.",
  csvTooLarge: "El archivo tiene demasiadas filas (máximo 500).",
  csvEmpty: "El archivo no tiene filas para importar.",
  csvNoEmailColumn: "Falta la columna email.",
} as const;

/** Espacios, carpetas y archivos (módulo 3). */
export const contentMessages = {
  controlledPdfUnavailable:
    "Este servidor no genera el PDF de las páginas controladas (falta Gotenberg). Quien administra la instalación puede activarlo.",
  untitledPage: "Sin título",
  controlledOnlyPagesFiles: "Solo las páginas y los archivos pueden ser documentos controlados.",
  controlledExists: "Ya es un documento controlado.",
  controlledLocked:
    "El documento está en revisión o aprobado: no se puede cambiar hasta que se publique o se devuelva.",
  noPdfForVersion: "Solo las versiones publicadas u obsoletas tienen PDF controlado.",
  pdfOnly: "El PDF controlado existe para páginas y archivos PDF.",
  nothingPublished: "Todavía no hay una versión publicada: publícala antes de pedir su lectura.",
  typeExists: "Ya hay un tipo de documento con ese código.",
  counterOnlyUp: "El contador solo puede subir: bajarlo repetiría códigos ya usados.",
  notControlled: "Este elemento no es un documento controlado.",
  nothingToSubmit: "No hay un borrador para enviar a revisión.",
  selfApprovalOff:
    "Quien envía un documento no puede aprobarlo (la autoaprobación está desactivada).",
  approverNotEligible:
    "Solo pueden aprobar quienes tienen permiso para aprobar este documento y lo ven.",
  notInReview: "El documento no está en revisión.",
  notApproved: "El documento todavía no está aprobado.",
  rejectNeedsComment: "Explica el motivo del rechazo.",
  unknownDocType: "Ese tipo de documento no existe.",
  copySuffix: "(copia)",
  pageTooLarge: "La página es demasiado grande. Divídela en dos.",
  pageInvalid: "El contenido de la página no es válido.",
  pageUnsafe: "La página tiene un enlace que no se permite (solo http, https y correo).",
  pageForeignImage: "La página usa una imagen que no es suya.",
  pageConflict: "Alguien más guardó cambios en esta página mientras la editabas.",
  spaceNameTaken: "Ya hay un espacio con ese nombre.",
  nameTaken: "Ya hay algo con ese nombre en esta carpeta.",
  parentNotFolder: "El destino tiene que ser una carpeta.",
  tooDeep: "Las carpetas no pueden anidarse tanto.",
  moveIntoItself: "No se puede mover una carpeta dentro de sí misma ni de sus subcarpetas.",
  spaceArchived: "El espacio está archivado: solo se puede leer.",
  subjectRequired: "Elige un departamento, una persona o toda la empresa (solo uno).",
  companyName: "Toda la empresa",
  companyLevel: "A toda la empresa se le puede dar Ver, Comentar o Editar.",
  limitedLevel:
    "Los lectores y los invitados externos no pueden editar ni gestionar: elige Ver o Comentar.",
  memberNotActive: "La persona tiene que ser un miembro activo.",
  expiryInPast: "La fecha de vencimiento tiene que ser futura.",
  noChanges: "No hay nada que cambiar.",
  lockout: "No puedes quitarte el acceso que te permite gestionar esto.",
  tooManyLevels: "Demasiados niveles de carpetas.",
  threadResolved: "El hilo está resuelto: reábrelo para responder.",
  compareOnlyPages: "Solo se comparan páginas.",
  pdfUnreadable: "No se pudo leer el PDF (¿está protegido?).",
};

/** Subidas y descargas de archivos (módulo 3). */
export const fileMessages = {
  unsupportedType:
    "Este tipo de archivo no está permitido. Se aceptan PDF, DOCX, XLSX, PPTX, ODT, ODS, TXT, CSV, PNG, JPG, WEBP y ZIP.",
  contentMismatch: "El contenido del archivo no coincide con su tipo.",
  markup: "No se admiten archivos HTML ni SVG.",
  binaryText: "El archivo de texto no es válido (tiene datos binarios o no es UTF-8).",
  notReceived: "El archivo no llegó completo. Vuelve a intentarlo.",
  sizeMismatch: "El tamaño del archivo no coincide con lo anunciado.",
  uploadExpired: "La subida venció. Empieza de nuevo.",
  partsIncomplete: "Faltan partes por subir.",
  notAFile: "Esto no es un archivo.",
  versionNotFound: "Esa versión no existe.",
  previewNotAllowed: "Este tipo de archivo no se puede ver en el navegador: descárgalo.",
  replaceNeedsFile: "Solo se puede reemplazar un archivo.",
  notAZip: "Solo se pueden importar archivos ZIP.",
  selectionChanged: "La selección creció y ya no se puede descargar directo. Pídela de nuevo.",
  zipTooBig:
    "La selección es demasiado grande para un solo ZIP (máximo 3,9 GB). Descárgala por partes.",
  zipNothing: "No hay archivos para descargar.",
  zipRequesterGone: "Quien pidió el ZIP ya no es parte del equipo.",
  zipFailed: "No se pudo generar el ZIP. Inténtalo de nuevo.",
  zipFileMissing:
    "Uno de los archivos ya no está disponible y no se pudo generar el ZIP. Vuelve a pedirlo.",
  importUnreadable: "No se pudo leer el archivo ZIP. ¿Está dañado?",
  importSpaceGone: "El espacio ya no está disponible.",
  importZipGone: "El ZIP ya no está disponible.",
  importTargetGone: "La carpeta de destino ya no está disponible.",
  importFolderFailed: "No se pudo crear la carpeta.",
  /** Nombre de la carpeta nueva si el ZIP no deja uno. */
  importFolderName: "Importación",
  pageImageTooLarge: "La imagen pesa más de 10 MB.",
  profileImageTooLarge: "La imagen pesa más de 5 MB.",
  imageInvalid: "La imagen no es válida.",
  imageNotReceived: "No llegó la imagen.",
  imageMismatch: "La imagen no es la que se pidió.",
  imageTypes: "Solo se aceptan imágenes JPG, PNG o WebP.",
};

/** Remitente de email propio por empresa (Seguridad › Email). */
export const customEmailTexts = {
  keyMissing: "El remitente propio no está disponible en este servidor.",
  incomplete: "Completa y guarda la configuración antes de probarla.",
  domainSoon: "El envío con dominio verificado estará disponible próximamente.",
  domainNotVerified: "Verifica primero los registros DNS del dominio.",
  invalidDomain: "Escribe un dominio válido, por ejemplo empresa.com.",
  noRecipient: "Tu cuenta no tiene un email donde recibir la prueba.",
  needsPassword: "Falta la contraseña del servidor SMTP.",
  notTested: "Envía un email de prueba con esta configuración antes de activarla.",
  invalidPort: "Usa uno de los puertos 25, 465, 587 o 2525.",
  hostNotFound: "No se encontró el servidor SMTP. Revisa el nombre.",
  hostPrivate: "El servidor SMTP debe ser público: no se permiten direcciones internas.",
  errors: {
    AUTH: "El servidor rechazó el usuario o la contraseña.",
    CONNECTION:
      "No se pudo conectar con el servidor SMTP. Revisa el servidor, el puerto y la seguridad.",
    TLS: "No se pudo establecer la conexión segura (certificado o TLS).",
    SENDER_REJECTED: "El servidor rechazó el remitente o el destinatario.",
    UNKNOWN: "El servidor SMTP devolvió un error al enviar.",
  },
  fallbackFromName: (workspace: string) => `${workspace} (vía SpiderFolio)`,
  alert: {
    subject: "Los emails de tu empresa salieron por SpiderFolio",
    title: "Falló tu servidor de email",
    body: "No pudimos enviar con el servidor SMTP de tu empresa. Para que nadie se quede sin su aviso, esos emails salieron con el remitente de SpiderFolio.",
    disabled:
      "Tras varios fallos seguidos desactivamos el remitente propio. Revisa la configuración y vuelve a probarla para activarlo.",
    action: "Revisar el remitente de email",
  },
  test: {
    subject: "Prueba del remitente de email de SpiderFolio",
    title: "El remitente funciona",
    body: (workspace: string) =>
      `Este email de prueba salió con el servidor SMTP configurado para ${workspace}. Si lo ves en tu bandeja, ya puedes activar el remitente propio.`,
  },
  /** Test of the server SMTP (the one in .env). */
  systemTest: {
    subject: "Prueba del email de SpiderFolio",
    title: "El email del servidor funciona",
    body: "Este email de prueba salió con el servidor SMTP configurado en esta instalación (SMTP_HOST en .env). Si lo ves en tu bandeja, las verificaciones, invitaciones y avisos van a llegar.",
  },
} as const;

/** Bian, el asistente IA: voz cercana y clara, español neutro con tuteo. */
export const bianTexts = {
  noEvidence: "No encontré esto en tus documentos.",
  /** Cuando lo que hay es parcial: así empieza la respuesta. */
  partialIntro: "Encontré esto en tus documentos:",
  /** Y, si corresponde, así termina. */
  mayHaveMore: "Puede haber más información; prueba con otras palabras o abre el documento.",
  suspiciousInstruction: (document: string) => `Posible instrucción sospechosa en ${document}`,
  unavailable: "Bian no está disponible en este momento. Inténtalo de nuevo en unos minutos.",
  workspaceOff: "Bian está desactivado en tu empresa.",
  guestsOff: "Bian no está habilitado para invitados.",
  refused: "No puedo ayudarte con esta pregunta. Prueba reformulándola.",
  providerError: "Bian tuvo un problema al responder. No se descontó tu consulta.",
  needsEdit: "Para redactar con Bian necesitas permiso de edición en esa carpeta.",
  draftNotice:
    "Borrador de Bian: revísalo antes de compartirlo. Puede tener errores, y lo que falta va entre corchetes para que lo completes.",
  draftFailed: "Bian no pudo armar el borrador. No se descontó tu consulta; inténtalo de nuevo.",
  notADocument: "Bian trabaja con páginas y archivos, no con carpetas.",
  notControlled: "«Qué cambió» es para documentos controlados, que tienen versiones.",
  singleVersion: "Este documento tiene una sola versión: no hay con qué compararlo.",
  noChanges: "No hay cambios entre estas versiones.",
  noText:
    "Todavía no puedo leer el texto de este documento (por ejemplo, un escaneo o un archivo que no es PDF ni DOCX).",
  summaryTruncated: "El documento es muy largo: resumí solo las primeras partes.",
  changesTruncated: "Había muchos cambios: expliqué los primeros.",
} as const;

/** Licencia y plugins (docs/spec/plugins.md). */
export const pluginTexts = {
  licenseInvalid:
    "La licencia no es válida. Copia el texto completo que te enviamos, sin cambios, y vuelve a intentarlo.",
  licenseExpired: "Esa licencia ya venció. Pídenos una nueva para seguir usando los plugins.",
  notCommunity: "Este plugin se activa con la licencia, no a mano.",
  acceptRiskRequired:
    "Para activar un plugin no verificado tienes que confirmar que tiene acceso al servidor.",
  licenseOtherCompany:
    "Esa licencia es de otra empresa. Pídenos la de tu empresa con el ID que ves en esta pantalla.",
  uploadDisabled: "En este servidor los plugins no se pueden subir desde la app.",
  uploadNeedsMfa:
    "Para subir un plugin necesitas tener activa la verificación en dos pasos (Mi perfil › Seguridad).",
  packageRejected: {
    format: "El archivo no es un plugin de SpiderFolio (.sfplugin) o está dañado.",
    tooLarge: "El archivo es demasiado grande para un plugin.",
    signature: "La firma del plugin no es válida: no lo publicó SpiderJAD o fue modificado.",
    tampered: "El plugin fue modificado después de firmarse.",
    manifest: "El plugin no tiene un manifiesto válido.",
    unsupported:
      "Este plugin necesita una versión más nueva de SpiderFolio. Actualiza el servidor primero.",
    license: "La licencia que trae el plugin no es válida o no lo incluye.",
    licenseExpired: "La licencia que trae el plugin ya venció.",
    licenseWorkspace: "La licencia que trae el plugin es de otra empresa.",
    downgrade: "Ya hay instalada una versión más nueva de este plugin.",
    builtIn: "Este plugin viene incluido en la imagen del servidor: se actualiza con la imagen.",
  },
  restartUnsupported:
    "Este servidor no se reinicia solo: reinicia la app y el worker desde el servidor para cargar los plugins.",
  restartPending: "Ya hay un reinicio programado.",
  removeBuiltIn:
    "Este plugin viene incluido en la imagen del servidor: no se puede quitar desde la app.",
  removeNotInstalled: "Este plugin no está entre los subidos desde la app.",
} as const;

/** Mensajes de validación (Zod) que vuelven a la app en `details.issues`. */
export const validationMessages = {
  invalidCursor: "Cursor inválido",
  invalidName: "Nombre inválido",
  noChanges: "Sin cambios",
  minimum: (value: number) => `Mínimo ${String(value)}`,
  contentMissing: "Falta el contenido",
  pinFormat: "El PIN lleva 6 dígitos",
  termsRequired: "Debes aceptar los Términos y condiciones y la Política de privacidad.",
  invalidTimeZone: "Zona horaria IANA inválida",
  uppercaseAndDigits: "Solo mayúsculas y números",
  colorFormat: "Color con formato #rrggbb",
  unknownCapability: "Capacidad desconocida",
  invalidHost: "Servidor inválido",
  invalidLocalPart: "Parte local inválida",
} as const;

/** Cuenta propia: contraseña y email (Mi perfil). */
export const accountMessages = {
  currentPasswordWrong: "La contraseña actual no es correcta.",
  sameEmail: "Ese ya es tu email.",
  emailTaken: "Ya hay una cuenta con ese email.",
} as const;

/** Inicio de sesión con verificación en dos pasos. */
export const mfaLoginMessages = {
  challengeExpired: "El inicio de sesión venció. Vuelve a escribir tu email y contraseña.",
} as const;

/** Verificación en dos pasos (Mi perfil). */
export const mfaMessages = {
  unavailable: "La verificación en dos pasos no está disponible en este servidor.",
  pinUsers: "Las cuentas de tablet (PIN) no usan verificación en dos pasos.",
  alreadyEnabled: "La verificación en dos pasos ya está activa.",
  notEnabled: "La verificación en dos pasos no está activa.",
  noSetup: "Primero empieza la activación para obtener el código QR.",
  invalidCode: "El código no es correcto o ya se usó. Prueba con el que muestra ahora tu app.",
  locked: "Demasiados códigos incorrectos. Espera 15 minutos y vuelve a intentarlo.",
  wrongPassword: "La contraseña no es correcta.",
} as const;

/** Reiniciar la verificación en dos pasos de otra persona (Miembros). */
export const mfaResetMessages = {
  self: "Para tu propia cuenta, usa Mi perfil.",
  actorWithoutMfa:
    "Solo un administrador con la verificación en dos pasos activa puede reiniciarla a otra persona.",
  notEnabled: "Esta persona no tiene la verificación en dos pasos activa.",
} as const;

/** PDF controlado: hoja de control, pie y marca de agua (en el idioma de la empresa). */
export const controlledPdfTexts = {
  sheetTitle: "Hoja de control del documento",
  code: "Código",
  title: "Título",
  version: "Versión",
  effective: "En vigor desde",
  elaboratedBy: "Elaboró",
  approvedBy: "Aprobó",
  sheetNote:
    "Esta hoja se agrega al descargar. El archivo original sigue igual en SpiderFolio; la versión vigente es siempre la de la aplicación.",
  /** Pie de página; `current` y `total` llegan como marcas HTML de Gotenberg. */
  pageFooter: (current: string, total: string) => `Página ${current} de ${total}`,
  watermark: (name: string, when: string) =>
    `Copia no controlada · descargada por ${name} el ${when}`,
  obsolete: "OBSOLETO",
} as const;

/** Códigos QR de documentos. */
export const qrTexts = {
  onlyDocuments: "El QR es para páginas, archivos y formularios.",
  formPrivateOnly: "El QR de un formulario es siempre privado: llenarlo pide iniciar sesión.",
  imageLabel: "Código QR",
  imageFileName: (name: string) => `QR ${name}`,
  labelsFileName: (name: string) => `Etiquetas QR ${name}`,
} as const;

/** CSV de los reportes de acceso y de «Quién puede ver esto». */
export const accessExportLabels = {
  reportTitles: {
    "cut-inheritance": "Herencia cortada",
    "direct-people": "Accesos directos a personas",
    guests: "Accesos de invitados",
    expiring: "Accesos que vencen pronto",
  },
  targetKinds: {
    space: "Espacio",
    FOLDER: "Carpeta",
    PAGE: "Página",
    FORM: "Formulario",
    FILE: "Archivo",
  },
  subjectKinds: { person: "Persona", department: "Departamento" },
  levels: { VIEW: "Ver", COMMENT: "Comentar", EDIT: "Editar", MANAGE: "Gestionar" },
  reportHeaders: [
    "Tipo",
    "Elemento",
    "Espacio",
    "Destinatario",
    "Tipo de destinatario",
    "Nivel",
    "Vence",
    "Dado el",
  ],
  reasons: {
    owner: "Propietario",
    admin: "Administrador",
    bypass: "Gestiona todo el contenido",
    leader: "Jefe o subjefe",
    member: "Parte del departamento",
    grant: "Acceso dado",
    company: "Espacio de la empresa",
    visible: "Espacio visible",
  },
  whoHeaders: ["Persona", "Puesto", "Rol", "Nivel", "Por qué"],
  whoFileName: (name: string) => `Quién accede a ${name}.csv`,
} as const;

/** Auditoría: listado y CSV. */
export const auditExportLabels = {
  invalidCursor: "Cursor inválido.",
  tooMany: (max: string) => `Son más de ${max} eventos: acota las fechas para exportar.`,
  headers: ["Fecha (UTC)", "Persona", "Email", "Acción", "Tipo", "Elemento", "IP", "Detalle"],
  staff: "Equipo de SpiderFolio",
  fileName: "registro-de-auditoria.csv",
} as const;

/** CSV de lecturas de un documento controlado. */
export const readingExportLabels = {
  headers: ["Persona", "Estado", "Leído el", "Plazo"],
  statuses: {
    read: "Leído",
    pending: "Pendiente",
    overdue: "Vencido",
    noAccess: "Sin acceso al documento",
  },
  fileName: (code: string) => `Lecturas ${code}.csv`,
} as const;

/** Administración de Bian: límites y CSV de uso. */
export const bianAdminTexts = {
  limitOnlyForLimitMode: "Indica el número solo cuando el modo es «un número de consultas».",
  blockedOnlyPerson: "«Sin acceso» solo se puede dar a una persona.",
  subjectMissing: "Falta indicar a quién se aplica el límite.",
  unlimited: "Sin límite",
  blocked: "Sin acceso",
  peopleHeaders: ["Persona", "Departamentos", "Consultas", "Límite"],
  departmentHeaders: ["Departamento", "Personas", "Consultas", "Límite por persona"],
  peopleFileName: (month: string) => `Uso de Bian por persona ${month}.csv`,
  departmentsFileName: (month: string) => `Uso de Bian por departamento ${month}.csv`,
} as const;

/** Datos que se crean con cada empresa, en el idioma de quien la crea. */
export const defaultDataTexts = {
  roles: {
    OWNER: {
      name: "Propietario",
      description:
        "Todo, incluida la licencia de plugins, transferir la propiedad y borrar el workspace.",
    },
    ADMIN: {
      name: "Administrador",
      description: "Todo lo administrativo, excepto la licencia de plugins y borrar el workspace.",
    },
    MEMBER: {
      name: "Miembro",
      description: "Usa el contenido según sus departamentos y permisos.",
    },
    GUEST: { name: "Invitado", description: "Externo: solo lo compartido explícitamente." },
  },
  documentTypes: {
    PRC: "Procedimiento",
    INS: "Instructivo",
    FOR: "Formulario",
    POL: "Política",
    MAN: "Manual",
  },
} as const;

/** Signing in with a company's directory (plugin auth providers). */
export const directorySignInTexts = {
  invalidCredentials: "Usuario o contraseña incorrectos.",
  unavailable: "Este inicio de sesión no está disponible. Entra con tu email y contraseña.",
  flowExpired:
    "El inicio de sesión tardó demasiado o se abrió en otro navegador. Vuelve a intentarlo.",
  emailTaken:
    "Ya hay una cuenta con el email de tu cuenta corporativa. Pídele al propietario de la empresa que la vincule.",
  notAllowed: "Tu cuenta corporativa no tiene acceso a esta empresa.",
  directoryOnlyNeedsOwner:
    "Antes, al menos un propietario tiene que poder entrar con su contraseña y la verificación en dos pasos.",
  alreadyLinked: "Esa cuenta del directorio ya está vinculada a otra persona.",
  memberAlreadyLinked: "Esa persona ya está vinculada a una cuenta del directorio.",
  noEncryptionKey:
    "El servidor no tiene configurada la clave de cifrado (EMAIL_ENCRYPTION_KEY): no se pueden guardar secretos.",
  unknownRole: "Ese rol no existe en la empresa o es el de propietario.",
  unknownDepartment: "Alguno de esos departamentos no existe en la empresa.",
} as const;

/** Formularios y registros (docs/spec/formularios.md). */
export const formMessages = {
  untitledForm: "Formulario sin título",
  notAForm: "Esto no es un formulario.",
  templateChanged:
    "Alguien cambió este formulario mientras lo editabas. Recarga para ver la versión actual y vuelve a hacer tus cambios.",
  duplicateId: "Hay dos campos u opciones con el mismo identificador.",
  rangeInverted: "El mínimo no puede ser mayor que el máximo.",
  unknownOption: "Una opción marcada como no conforme no existe en el campo.",
  notAFileField: "Ese campo no es de foto ni de firma.",
  fileTooLarge: "La foto pesa más de 10 MB.",
  signatureType: "La firma tiene que ser una imagen PNG.",
  unknownVersion: "Esa versión del formulario no existe.",
  answersInvalid: "Revisa las respuestas marcadas.",
  filesInvalid: "Alguna foto o firma no se subió bien. Vuelve a cargarla.",
  weekdaysRequired: "Elige al menos un día de la semana.",
  assigneesRequired: "Elige al menos una persona o un departamento que lo llene.",
  unknownPeople: "Alguna de esas personas o departamentos no está en la empresa.",
  alreadyVoided: "Ese registro ya está anulado.",
  pdfUnavailable:
    "Esta instalación no genera PDF (falta Gotenberg). Exporta en CSV o pide a quien la administra que lo active.",
} as const;

/** Seguridad y salud laboral (docs/spec/seguridad-salud.md): lo que crea al activarse. */
export const safetyTexts = {
  space: {
    es: {
      name: "Prevención de riesgos laborales",
      description: "Evaluaciones de riesgos, EPIs, formación y accidentes.",
    },
    latam: {
      name: "Seguridad y salud en el trabajo",
      description: "Evaluaciones de riesgos, EPP, capacitación y accidentes.",
    },
  },
  riskAssessmentType: "Evaluación de riesgos",
  /** The emergency plan's document type (PEM, reviewed every year). */
  emergencyPlanType: { es: "Plan de emergencia", latam: "Plan de emergencias" },
  /** The emergency team's default roles. */
  emergencyRoles: {
    es: [
      "Jefe de emergencia",
      "Jefe de intervención",
      "Equipo de primera intervención",
      "Equipo de segunda intervención",
      "Primeros auxilios",
      "Evacuación",
    ],
    latam: [
      "Coordinador de emergencias",
      "Jefe de brigada",
      "Brigada de primera respuesta",
      "Brigada contra incendios",
      "Brigada de primeros auxilios",
      "Brigada de evacuación",
    ],
  },
  drills: {
    scenarios: {
      FIRE: "incendio",
      EVACUATION: "evacuación",
      SPILL: "derrame químico",
      AMMONIA: "fuga de amoníaco",
      OTHER: "otra emergencia",
    },
    expiryWhat: "Simulacro anual de emergencia",
    messages: {
      roleNameTaken: "Ya hay un rol con ese nombre en el equipo.",
      alreadyMember: "Esa persona ya está en ese rol.",
    },
  },
  /** Consultation and participation: the committee, its members and its meetings. */
  committee: {
    name: { es: "Comité de seguridad y salud", latam: "Comité paritario" },
    kinds: { ORDINARY: "ordinaria", EXTRAORDINARY: "extraordinaria" },
    roles: {
      es: {
        DELEGATE: "Delegado de prevención",
        COMPANY_REP: "Representante de la empresa",
        ADVISOR: "Técnico de prevención (asesor)",
        SECRETARY: "Secretario",
      },
      latam: {
        DELEGATE: "Representante de los trabajadores",
        COMPANY_REP: "Representante del empleador",
        ADVISOR: "Asesor en prevención",
        SECRETARY: "Secretario",
      },
    },
    mandateWhat: (person: string) => `Fin del mandato de ${person}`,
    meetingWhat: "Reunión trimestral del comité",
    minutes: {
      title: (day: string) => `Acta de la reunión del ${day}`,
      date: "Fecha",
      kind: "Tipo",
      attendees: "Asistentes",
      noAttendees: "Sin asistentes anotados.",
      agenda: "Orden del día",
      noAgenda: "Sin orden del día.",
      discussion: "Desarrollo de la reunión",
      agreements: "Acuerdos",
    },
    messages: {
      alreadyMember: "Esa persona ya está en el comité.",
      notMember: "Los asistentes tienen que ser miembros del comité.",
      termOrder: "El fin del mandato no puede ser anterior a su inicio.",
      minutesOutside: "El acta tiene que ser una página o un archivo del espacio del módulo.",
      noSpace: "El módulo no tiene espacio: guarda los ajustes de Prevención para crearlo.",
    },
  },
  examplePositions: [
    "Operario de producción",
    "Operario de cámaras frigoríficas",
    "Operario de expedición",
    "Técnico de mantenimiento",
    "Encargado de turno",
  ],
  incidentForm: {
    name: "Accidente o incidente",
    date: "Fecha",
    time: "Hora (aproximada)",
    place: "Lugar",
    person: "Persona afectada",
    personHelp: "Déjalo vacío si nadie resultó afectado.",
    type: "Tipo",
    types: {
      baja: "Accidente con baja",
      sin_baja: "Accidente sin baja",
      incidente: "Incidente (daños materiales)",
      casi: "Casi accidente",
    },
    severity: "Gravedad",
    severityHelp: "Solo si hubo lesiones.",
    severities: { leve: "Leve", grave: "Grave", muy_grave: "Muy grave", mortal: "Mortal" },
    what: "Qué pasó",
    whatHelp: "Describe lo que pasó. No escribas datos médicos ni diagnósticos.",
    causes: "Causas",
    photos: "Fotos",
    witnesses: "Testigos",
  },
  lockedField: (label: string) =>
    `«${label}» es un campo fijo del formulario de accidentes: puedes cambiar su texto, pero no quitarlo ni cambiar su tipo u opciones.`,
  incidents: {
    notFoundActions: "Primero marca como hechas todas las medidas.",
    alreadyClosed: "El caso ya está cerrado.",
    notClosed: "El caso no está cerrado.",
    alreadyInvestigating: "El caso ya está en investigación.",
    actionDone: "Esa medida ya está hecha.",
    tooMany: (max: string) => `Son demasiados para exportar (hasta ${max}). Acota con los filtros.`,
    csv: {
      fileName: "accidentes-e-incidentes.csv",
      date: "Fecha",
      type: "Tipo",
      severity: "Gravedad",
      place: "Lugar",
      person: "Persona afectada",
      department: "Departamento",
      reportedBy: "Comunicó",
      status: "Estado",
      actions: "Medidas hechas",
      open: "Abierto",
      investigating: "En investigación",
      closed: "Cerrado",
    },
  },
  planning: {
    origins: {
      INCIDENT: "Accidente o incidente",
      RISK_ASSESSMENT: "Evaluación de riesgos",
      INSPECTION: "Inspección",
      DRILL: "Simulacro",
      COMMITTEE: "Comité",
      OTHER: "Otra",
    },
    priorities: { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta" },
    incidentOf: (day: string) => `Accidente o incidente del ${day}`,
    drillOf: (scenario: string, day: string) => `Simulacro de ${scenario} del ${day}`,
    meetingOf: (kind: string, day: string) => `Reunión ${kind} del ${day}`,
    recordOf: (form: string, day: string) => `${form} del ${day}`,
    messages: {
      notRiskAssessment: "Ese documento no es una evaluación de riesgos (tipo EVR).",
      recordConforming: "Ese registro no tiene respuestas no conformes.",
    },
    csv: {
      fileName: "planificacion-preventiva.csv",
      description: "Medida",
      origin: "Origen",
      reference: "Referencia",
      priority: "Prioridad",
      cost: "Coste estimado",
      responsible: "Responsable",
      dueOn: "Fecha límite",
      status: "Estado",
      doneOn: "Hecha el",
      open: "Pendiente",
      overdue: "Vencida",
      done: "Hecha",
    },
  },
  indicators: {
    messages: { notMonth: "El mes tiene que ser su primer día (AAAA-MM-01)." },
    csv: {
      fileName: (year: number) => `indicadores-siniestralidad-${String(year)}.csv`,
      period: "Periodo",
      hours: "Horas trabajadas",
      headcount: "Plantilla media",
      accidents: "Accidentes con baja",
      lostDays: "Días de baja",
      frequency: "Índice de frecuencia",
      severity: "Índice de gravedad",
      incidence: "Índice de incidencia",
      ytd: (year: number) => `Año ${String(year)} hasta la fecha`,
      last12: "Últimos 12 meses",
    },
  },
  training: {
    alreadyCourse: "Ese documento ya es un curso.",
    stillValid: "Tu formación de este curso sigue vigente.",
    repeated: "Una misma persona aparece dos veces en la asistencia.",
    notListed: "No estás en la lista de esta formación. Pídele a quien la dio que te agregue.",
    sessionClosed: "Esta firma ya está cerrada: pídele a quien dio la formación que abra otra.",
    alreadySigned: "Ya firmaste esta formación.",
    noAttendees: "Elige al menos una persona para la firma.",
  },
  personPdf: {
    title: "Ficha de prevención",
    generated: (when: string, who: string) => `Generada el ${when} por ${who}.`,
    position: "Puesto",
    noPosition: "Sin puesto",
    departments: "Departamentos",
    health: "Incluye datos de salud: trátala como confidencial y no la compartas.",
    ppe: {
      title: "Equipos de protección (EPIs)",
      item: "Equipo",
      quantity: "Cantidad",
      size: "Talla",
      delivered: "Entregado",
      replaceOn: "Reponer el",
      none: "No tiene EPIs entregados.",
      missing: "Le falta por su puesto:",
      expired: "vencido",
    },
    training: {
      title: "Formación",
      course: "Curso",
      state: "Estado",
      completed: "Hecha",
      validUntil: "Vence",
      none: "No tiene cursos asignados.",
    },
    states: {
      valid: "Vigente",
      due_soon: "Por vencer",
      expired: "Vencida",
      pending: "Pendiente",
    },
    fitness: {
      title: "Aptitud",
      status: "Resultado",
      validUntil: "Hasta",
      restrictions: "Restricciones",
      none: "No hay evaluaciones de aptitud.",
      statuses: { APT: "Apto", APT_RESTRICTED: "Apto con restricciones", NOT_APT: "No apto" },
    },
    incidents: {
      title: "Accidentes e incidentes",
      date: "Fecha",
      type: "Tipo",
      place: "Lugar",
      status: "Estado",
      none: "No tiene accidentes ni incidentes.",
    },
    fileName: (person: string, day: string) => `Ficha de prevención ${person} ${day}.pdf`,
  },
  attendancePdf: {
    title: "Constancia de asistencia a formación",
    person: "Asistente",
    signature: "Firma",
    recordedBy: (who: string) => `Registró ${who}.`,
    fileName: (course: string, day: string) => `Asistencia ${course} ${day}.pdf`,
  },
  fitnessWhat: (person: string) => `Aptitud de ${person}`,
  examplePpe: [
    { name: "Guantes anticorte", category: "Manos", hasSizes: true, lifeMonths: 6 },
    { name: "Calzado de seguridad", category: "Pies", hasSizes: true, lifeMonths: 12 },
    {
      name: "Chaqueta para c\u00e1mara frigor\u00edfica",
      category: "Cuerpo",
      hasSizes: true,
      lifeMonths: 24,
    },
    { name: "Protecci\u00f3n auditiva", category: "O\u00eddos", hasSizes: false, lifeMonths: 1 },
    { name: "Gafas de seguridad", category: "Ojos", hasSizes: false, lifeMonths: 12 },
    { name: "Delantal de malla", category: "Cuerpo", hasSizes: true, lifeMonths: 24 },
  ],
  inspectionForm: {
    name: "Inspecci\u00f3n de seguridad mensual",
    checks: "Comprobaciones",
    items: [
      "Salidas de emergencia libres y se\u00f1alizadas",
      "Extintores en su sitio y revisados",
      "Botiqu\u00edn completo",
      "Protecciones de las m\u00e1quinas colocadas",
      "Suelos secos y sin obst\u00e1culos",
      "Cada persona usa sus EPIs",
    ],
    notes: "Observaciones",
    signature: "Firma de quien inspecciona",
  },
  ppe: { es: "EPI", latam: "EPP" },
  messages: {
    itemNameTaken: "Ya hay un equipo con ese nombre en el catálogo.",
    itemArchived: "Ese equipo está archivado: no se puede entregar.",
    signatureInvalid: "Falta la firma de quien recibe, o no es una imagen válida.",
    alreadyVoided: "Esa entrega ya está anulada.",
    sizeRequired: (item: string) => `Falta la talla de «${item}».`,
    repeatedItem: "Un mismo equipo aparece dos veces en la entrega.",
  },
  expiryWhat: (item: string, person: string) => `${item} de ${person}`,
  pdf: {
    title: (ppe: string) => `Constancia de entrega de ${ppe}`,
    person: "Recibe",
    position: "Puesto",
    deliveredBy: "Entrega",
    date: "Fecha",
    columns: { item: "Equipo", quantity: "Cantidad", size: "Talla", replaceOn: "Reponer el" },
    note: "Observaciones",
    signature: "Firma de quien recibe",
    statement:
      "Recibí los equipos de protección indicados, en buen estado, y la información sobre su uso, conservación y reposición. Me comprometo a usarlos y a avisar si se dañan o se pierden.",
    voided: (when: string, who: string, reason: string) =>
      `Anulada el ${when} por ${who}: ${reason}`,
    fileName: (person: string, day: string) => `Entrega ${person} ${day}.pdf`,
    pageFooter: (page: string, total: string) => `Página ${page} de ${total}`,
  },
} as const;

/** CAE, coordination of business activities (docs/spec/cae.md): what it creates and its reasons. */
export const caeTexts = {
  folder: { es: "Contratas", latam: "Contratistas" },
  /** The default catalog's names, by the country's terms (the structure is in cae-catalog.ts). */
  catalog: {
    es: {
      liabilityInsurance: "Seguro de responsabilidad civil y recibo",
      socialSecurityCert: "Certificado de estar al corriente con la Seguridad Social",
      taxCert: "Certificado de estar al corriente con Hacienda",
      preventiveModality: "Modalidad de organización preventiva",
      riskAssessment: "Evaluación de riesgos de los trabajos a realizar",
      preventivePlanning: "Planificación de la actividad preventiva",
      workerList: "Relación de trabajadores (RNT/ITA)",
      prlTraining: "Formación en PRL del puesto",
      medicalFitness: "Certificado de aptitud médica",
      ppeHandout: "Entrega de EPI",
      socialSecurityRegistration: "Alta en la Seguridad Social",
      siteRiskInfo: "Información de riesgos del centro recibida",
    },
    latam: {
      liabilityInsurance: "Seguro de responsabilidad civil",
      socialSecurityPayment: "Constancia de pago de seguridad social",
      riskMatrix: "Matriz de riesgos de los trabajos",
      sstProgram: "Programa de SST",
      sstTraining: "Capacitación en SST",
      medicalFitness: "Aptitud médica",
      ppeHandout: "Entrega de EPP",
      socialSecurityAffiliation: "Afiliación a seguridad social",
      siteInduction: "Inducción de seguridad del centro",
    },
  },
  expiryWhat: (requirement: string, subject: string) => `${requirement} de ${subject}`,
  workerOf: (worker: string, company: string) => `${worker} (${company})`,
  pdf: {
    title: "Autorizados hoy",
    generated: (when: string, who: string) => `Generado el ${when} por ${who}.`,
    company: "Empresa",
    date: "Día",
    companyStatus: "Estado de la empresa",
    authorized: "Autorizada",
    notAuthorized: "No autorizada",
    columns: {
      worker: "Trabajador",
      idNumber: "Documento",
      task: "Puesto o tarea",
      status: "¿Puede entrar?",
      reasons: "Motivos",
    },
    yes: "Sí",
    no: "No",
    none: "No tiene trabajadores activos.",
    fileName: (company: string, day: string) => `Autorizados hoy ${company} ${day}.pdf`,
    pageFooter: (page: string, total: string) => `Página ${page} de ${total}`,
  },
  info: {
    pdf: {
      title: "Constancia de entrega de información a una empresa externa",
      company: "Empresa",
      date: "Fecha de entrega",
      receivedBy: "Recibe",
      deliveredBy: "Entrega",
      columns: { code: "Código", title: "Documento", version: "Versión" },
      statement:
        "Recibí la información sobre los riesgos del centro, las medidas de prevención y de emergencia y las instrucciones indicadas, en las versiones vigentes, para transmitirla a los trabajadores de mi empresa (Real Decreto 171/2004, artículos 7 a 9).",
      signature: "Firma de quien recibe",
      noSignature: "Sin firma en pantalla.",
      fileName: (company: string, day: string) => `Entrega de información ${company} ${day}.pdf`,
      pageFooter: (page: string, total: string) => `Página ${page} de ${total}`,
    },
  },
  permits: {
    types: {
      HOT_WORK: "Trabajos en caliente",
      HEIGHT: "Trabajos en altura",
      CONFINED_SPACE: "Espacios confinados",
      ELECTRICAL: "Trabajos eléctricos",
      OTHER: "Otro",
    },
    statuses: {
      DRAFT: "Borrador",
      ACTIVE: "Activo",
      CLOSED: "Cerrado",
      CANCELLED: "Anulado",
    },
    pdf: {
      title: "Permiso de trabajo",
      type: "Tipo",
      status: "Estado",
      company: "Empresa",
      ownCompany: "Personal propio",
      location: "Lugar",
      description: "Trabajo",
      validity: "Validez",
      from: "Desde",
      to: "Hasta",
      people: "Personas autorizadas",
      precautions: "Medidas de prevención comprobadas",
      done: "Sí",
      notDone: "No",
      issuedBy: "Emitió",
      approvedBy: "Aprobó",
      signature: "Firma de quien aprueba",
      closed: (when: string, who: string) => `Cerrado el ${when} por ${who}.`,
      cancelled: (when: string, who: string) => `Anulado el ${when} por ${who}.`,
      note: "Observaciones",
      fileName: (type: string, day: string) => `Permiso de trabajo ${type} ${day}.pdf`,
      pageFooter: (page: string, total: string) => `Página ${page} de ${total}`,
    },
  },
  foodCatalog: {
    es: {
      pestControl: "Certificado de la empresa de control de plagas (ROESB)",
      foodHandling: "Formación en manipulación de alimentos",
      hygieneRules: "Normas de higiene y buenas prácticas de fabricación del centro recibidas",
    },
    latam: {
      pestControl: "Habilitación sanitaria de la empresa de control de plagas",
      foodHandling: "Capacitación en manipulación de alimentos",
      hygieneRules: "Normas de higiene y BPM del centro recibidas",
    },
  },
  portal: {
    /** The same answer for any problem with the link or the code: nothing is learned from it. */
    invalid: "El enlace o el código no son válidos, o el acceso ya no está activo.",
    noSession: "Tu sesión terminó: vuelve a entrar con el código.",
    fileType: "Sube un PDF o una foto (JPG o PNG).",
    fileTooLarge: (mb: number) => `El archivo pesa más de ${String(mb)} MB.`,
    infoNotChosen: "Ese documento no está entre la información del centro.",
    uploadGone: "Esa subida ya no está: vuelve a subir el archivo.",
  },
  messages: {
    companyNameTaken: "Ya hay una empresa con ese nombre.",
    requirementNameTaken: "Ya hay un documento exigido con ese nombre.",
    parentRequired: "Una subcontrata necesita la contrata de la que depende.",
    parentInvalid: "La empresa de la que depende tiene que ser una contrata activa.",
    parentOnlySubcontractor: "Solo una subcontrata depende de otra empresa.",
    hasSubcontractors: "Esta contrata tiene subcontratas: cámbialas o archívalas antes.",
    datesInverted: "La fecha de fin no puede ser anterior a la de inicio.",
    responsibleInvalid: "El responsable interno tiene que ser una persona activa de la empresa.",
    archived: "Está archivada: no se puede cambiar.",
    workerArchived: "Está archivado: no se puede cambiar.",
    alreadyBlocked: "Ya está bloqueado.",
    notBlocked: "No está bloqueado.",
    alreadyArchived: "Ya está archivado.",
    moduleOff: "Primero activa el módulo de seguridad y salud laboral.",
    nodeNotInFolder:
      "El archivo tiene que estar en la carpeta de la empresa (o en una dentro de ella).",
    noFolder: "La empresa no tiene carpeta: revisa que el espacio del módulo exista.",
    requirementScope:
      "Ese documento se pide a la empresa o a cada trabajador: elige bien a quién corresponde.",
    requirementNotApplicable: "Ese documento no se le pide a este tipo de empresa.",
    requirementArchived: "Ese documento exigido está archivado.",
    workerNotInCompany: "Ese trabajador no es de esta empresa.",
    notPending: "Ese documento ya está revisado.",
    accessLogOff: "El registro de entradas y salidas no está activado.",
    deniedIn: "No está autorizado: no se puede registrar su entrada.",
    infoNotDocument: "Ese documento no es un documento controlado vigente.",
    infoNotChosen: "Ese documento no está entre la información para contratas.",
    infoNone: "Primero elige qué documentos controlados son la información para contratas.",
    permitNotDraft: "Solo se cambia un permiso en borrador.",
    permitNotActive: "Ese permiso no está activo.",
    permitClosed: "Ese permiso ya está cerrado o anulado.",
    permitDates: "La fecha de fin tiene que ser posterior a la de inicio.",
    permitTooLong: (days: number) =>
      `Un permiso dura como máximo ${String(days)} días: para más, emite otro.`,
    permitEnded: "Ese permiso ya venció: emite otro.",
    permitNoPeople: "Agrega al menos una persona al permiso.",
    permitTooManyPeople: (max: number) => `Un permiso lleva como máximo ${String(max)} personas.`,
    permitCustomName: "Escribe qué tipo de permiso es.",
    permitWorkerCompany: "Los trabajadores tienen que ser de la empresa del permiso.",
    permitWorkerNotAuthorized: (name: string) =>
      `${name} no está autorizado: no puede ir en el permiso.`,
    permitMemberInvalid: "Alguna de esas personas no está activa en la empresa.",
    permitPrecautionsPending:
      "Marca todas las medidas de prevención como comprobadas antes de aprobarlo.",
    orderMismatch: "El orden tiene que incluir todos los documentos exigidos de ese tipo, una vez.",
  },
  /** Why a company or a worker isn't authorized (caeStatus). */
  reasons: {
    missing: (requirement: string) => `Falta: ${requirement}`,
    expired: (day: string, requirement: string) => `Vencido el ${day}: ${requirement}`,
    pending: (requirement: string) => `Por revisar: ${requirement}`,
    rejected: (requirement: string) => `Rechazado: ${requirement}`,
    companyBlocked: (reason: string) => `Empresa bloqueada: ${reason}`,
    companyArchived: "Empresa archivada",
    notStarted: (day: string) => `Empieza a trabajar el ${day}`,
    ended: (day: string) => `Terminó de trabajar el ${day}`,
    parentNotAuthorized: (name: string) => `Su contrata no está autorizada: ${name}`,
    companyNotAuthorized: (name: string) => `Su empresa no está autorizada: ${name}`,
    workerBlocked: (reason: string) => `Trabajador bloqueado: ${reason}`,
    infoMissing: (doc: string) => `Falta entregar la información del centro: ${doc}`,
    workerArchived: "Trabajador archivado",
  },
} as const;

/** Vencimientos (docs/spec/seguridad-salud.md, «Motor de vencimientos»): algo vence o venció. */
export const expiryNoticeTexts = {
  greeting: (name: string) => `Hola ${name}:`,
  subject: {
    soon: (what: string) => `Vence: ${what}`,
    expired: (what: string) => `Venció: ${what}`,
  },
  title: { soon: "Algo está por vencer", expired: "Algo venció" },
  body: (what: string, when: string) => `«${what}» ${when}.`,
  when: {
    inDays: (date: string, days: number) => `vence el ${date} (en ${String(days)} días)`,
    tomorrow: (date: string) => `vence mañana, ${date}`,
    today: "vence hoy",
    past: (date: string) => `venció el ${date}`,
  },
  action: "Ver",
  footnote: "Recibes este aviso porque te toca ocuparte de este vencimiento o porque es tuyo.",
} as const;

/**
 * A new accident or incident (docs/spec/seguridad-salud.md): to whoever has safety.health. Health data:
 * never what happened nor who was hurt in the email, only that there's a new case and where it opens.
 */
export const safetyIncidentEmailTexts = {
  greeting: (name: string) => `Hola ${name}:`,
  subject: "Se comunicó un accidente o incidente nuevo",
  title: "Hay un caso nuevo",
  body: (who: string) =>
    `${who} comunicó un accidente o incidente. Por ser datos de salud, el detalle está solo en la app.`,
  action: "Ver el caso",
  footnote: "Recibes este aviso porque puedes ver los datos de salud de la empresa.",
} as const;

/** Avisos de formularios (docs/spec/formularios.md): no conformidades y períodos. */
export const formNoticeTexts = {
  greeting: (name: string) => `Hola ${name}:`,
  form_nonconforming: {
    subject: (what: string) => `No conforme: ${what}`,
    title: "Un registro tiene respuestas no conformes",
    body: (who: string, what: string, fields: string) =>
      `${who} envió un registro de \u00ab${what}\u00bb con respuestas fuera de lo esperado: ${fields}.`,
    action: "Ver el registro",
  },
  form_due: {
    subject: (what: string) => `Para llenar: ${what}`,
    title: "Hay un formulario para llenar",
    body: (what: string, period: string) =>
      `Toca llenar \u00ab${what}\u00bb (${period}). Con un registro de cualquiera de las personas asignadas, queda hecho.`,
    action: "Llenar el formulario",
  },
  form_overdue: {
    subject: (what: string) => `Sin registro: ${what}`,
    title: "Un formulario quedó sin llenar",
    body: (what: string, period: string) => `Nadie llenó \u00ab${what}\u00bb en ${period}.`,
    action: "Abrir el formulario",
  },
  periods: {
    day: (date: string) => `el ${date}`,
    week: (monday: string) => `la semana del ${monday}`,
    month: (month: string) => month,
  },
  footnote: "Recibes este aviso por el formulario en el que participas o del que eres responsable.",
} as const;

/** Registros exportados (docs/spec/formularios.md, fase 4): CSV y PDF. */
export const formExportTexts = {
  fileName: (form: string, extension: string) => `${form} - registros.${extension}`,
  headers: [
    "Fecha",
    "Persona",
    "Versión",
    "Origen",
    "No conforme",
    "Anulado el",
    "Motivo de la anulación",
  ],
  sources: { app: "App", qr: "QR" },
  words: {
    yes: "Sí",
    no: "No",
    unchecked: (items: string) => `(sin marcar: ${items})`,
    photos: (count: number) => (count === 1 ? "1 foto" : `${String(count)} fotos`),
    signed: "Firmado",
  },
  version: (version: number) => `Versión ${String(version)}`,
  nonConforming: "No conforme",
  voided: (at: string, by: string, reason: string) => `Anulado el ${at} por ${by}: ${reason}`,
  summary: (space: string, at: string, count: number) =>
    `${space} · Exportado el ${at} · ${count === 1 ? "1 registro" : `${String(count)} registros`}`,
  empty: "No hay registros con esos filtros.",
  tooMany: (max: string) => `Son más de ${max} registros. Acota las fechas y vuelve a exportar.`,
  pageFooter: (page: string, total: string) => `Página ${page} de ${total}`,
} as const;

export const expiryTexts = {
  csv: {
    fileName: "vencimientos.csv",
    tooMany: "Hay demasiados vencimientos para exportar. Filtrá la lista y probá de nuevo.",
    dueOn: "Vence",
    element: "Elemento",
    space: "Espacio",
    state: "Estado",
    responsible: "Responsable",
    note: "Nota",
    states: { valid: "Vigente", due_soon: "Por vencer", expired: "Vencido" },
  },
};

/** Audit rooms (docs/spec/salas-de-auditoria.md): the auditor's emails, the watermark and the reports. */
export const auditRoomTexts = {
  watermark: (email: string, when: string) => `Copia para auditoría · ${email} · ${when}`,
  invite: {
    subject: (company: string) => `${company} te comparte una sala de auditoría`,
    title: "Tienes una sala de auditoría",
    body: (company: string, room: string, until: string) =>
      `${company} compartió contigo la sala «${room}», en solo lectura, hasta el ${until}.`,
    how: "Al abrirla, pide el código: te llega a este email y vale una sola vez.",
    action: "Abrir la sala",
    footnote: "Si no esperabas este email, puedes ignorarlo: sin el código no se entra.",
  },
  code: {
    subject: (code: string) => `Tu código para la sala de auditoría: ${code}`,
    title: "Tu código de acceso",
    body: (room: string) =>
      `Este es tu código para entrar a «${room}». Vale 10 minutos y una sola vez:`,
    footnote: "Si no lo pediste, ignora este email: nadie entra sin el código.",
  },
  errors: {
    closed: "Esta sala ya no está disponible: venció o la revocaron.",
    badCode: "El código no es correcto o ya venció. Pide uno nuevo.",
    tooManyTries: "Demasiados intentos con este código. Pide uno nuevo.",
    noSession: "Tu acceso a la sala terminó. Vuelve a pedir el código.",
    maxDays: "La sala puede durar hasta 30 días.",
    pastDate: "El vencimiento tiene que ser una fecha futura.",
    notShareable: "Ese elemento no se puede compartir en una sala.",
    unsupported:
      "Este tipo de archivo no se puede mostrar en la sala. Comparte un PDF, Word, Excel o una imagen.",
    noDownload: "Esta sala no permite descargar.",
    creatorGone: "Quien creó la sala ya no está en la empresa: la sala no se puede abrir.",
  },
  reports: {
    readings: (doc: string) => `Cumplimiento de lecturas · ${doc}`,
    approvals: (doc: string) => `Historial de aprobaciones y versiones · ${doc}`,
    formRecords: (form: string, from: string, to: string) =>
      `Registros de «${form}» · ${from} a ${to}`,
    training: (course: string) => `Constancias de formación · ${course}`,
    ppe: (from: string, to: string) => `Entregas de EPIs · ${from} a ${to}`,
    auditLog: (from: string, to: string) => `Registro de auditoría · ${from} a ${to}`,
    generated: (when: string) => `Generado el ${when}.`,
    columns: {
      person: "Persona",
      status: "Estado",
      readAt: "Leyó",
      version: "Versión",
      state: "Estado",
      published: "Publicada",
      approvals: "Aprobaciones",
      change: "Cambio",
      date: "Fecha",
      by: "Por",
      record: "Registro",
      values: "Respuestas",
      item: "Equipo",
      quantity: "Cantidad",
      action: "Acción",
      what: "Sobre",
      completed: "Hecha",
      source: "Cómo",
      until: "Vence",
    },
    readingStatus: {
      read: "Leído",
      pending: "Pendiente",
      overdue: "Vencido",
      noAccess: "Sin acceso",
    },
    sources: { READING: "Lectura", IN_PERSON: "Presencial" },
    decisions: { APPROVED: "Aprobó", CHANGES_REQUESTED: "Pidió cambios", REJECTED: "Rechazó" },
    empty: "Sin datos en este período.",
    voided: "Anulado",
  },
  notice: {
    firstAccess: "entró por primera vez",
  },
} as const;

/** Food quality (docs/spec/calidad.md): nonconformities and CAPA. */
export const qualityTexts = {
  space: {
    name: "Calidad",
    description: "Documentos, registros y evidencias de calidad y seguridad alimentaria.",
  },
  ncFolder: "No conformidades",
  code: (year: number, number: number) => `NC-${String(year)}-${String(number).padStart(4, "0")}`,
  origins: {
    INTERNAL: "Interna",
    CCP: "PCC o registro fuera de límite",
    AUDIT_INTERNAL: "Auditoría interna",
    AUDIT_EXTERNAL: "Auditoría externa",
    COMPLAINT: "Reclamación",
    SUPPLIER: "Proveedor",
    OTHER: "Otra",
  },
  severities: { MINOR: "Menor", MAJOR: "Mayor", CRITICAL: "Crítica" },
  statuses: {
    OPEN: "Abierta",
    ANALYSIS: "En análisis",
    ACTIONS: "Con acciones",
    VERIFICATION: "En verificación",
    CLOSED: "Cerrada",
    CANCELLED: "Anulada",
  },
  kinds: { CORRECTION: "Corrección", CORRECTIVE: "Correctiva", PREVENTIVE: "Preventiva" },
  /** The title of a nonconformity opened from a form record. */
  fromRecord: (form: string) => `${form}: registro no conforme`,
  fromRecordDescription: (fields: string) => `Campos fuera de límite: ${fields}.`,
  verifyWhat: (code: string) => `Verificar la eficacia de ${code}`,
  messages: {
    moduleOff: "El módulo de calidad no está activo.",
    closed: "La no conformidad está cerrada o anulada.",
    notClosed: "Solo se puede reabrir una no conformidad cerrada.",
    actionDone: "La acción ya está hecha.",
    tooManyActions: (max: number) =>
      `Una no conformidad puede tener hasta ${String(max)} acciones.`,
    actionsPending: "Todavía hay acciones sin hacer.",
    noActions: "Agrega al menos una acción antes de verificar.",
    notInVerification: "La no conformidad no está en verificación.",
    recordConforming: "El registro no tiene respuestas no conformes.",
    analysisInvalid: "El análisis de causas no es válido para el método elegido.",
    tooMany: (max: string) => `Hay más de ${max} filas: acota los filtros.`,
  },
  /** Phase 2 (docs/spec/calidad.md, «Fase 2»): HACCP, critical control points and holds. */
  haccpType: "Plan APPCC",
  hazardTypes: {
    BIOLOGICAL: "Biológico",
    CHEMICAL: "Químico",
    PHYSICAL: "Físico",
    ALLERGEN: "Alérgeno",
  },
  holdStatuses: {
    HELD: "Retenido",
    RELEASED: "Liberado",
    REWORKED: "Reprocesado",
    DIVERTED: "Otro destino",
    DESTROYED: "Destruido / SANDACH",
  },
  haccpMessages: {
    codeTaken: "Ya hay un PCC con ese código.",
    formNotFound: "El formulario de vigilancia no existe o está en la papelera.",
    holdDecided: "Sobre este producto ya se decidió.",
    templateDone: "La plantilla cárnica ya estaba cargada.",
    noSpace: "El espacio del módulo de calidad no existe: vuelve a guardar los ajustes.",
    orderInvalid: "El orden tiene que incluir todos los PCC activos.",
  },
  template: {
    folder: "Registros de vigilancia (PCC)",
    signature: "Firma de quien registra",
    lot: "Lote",
    product: "Producto",
    temperature: "Temperatura",
    forms: {
      reception: {
        name: "Recepción de materia prima",
        supplier: "Proveedor",
        healthNumber: "Registro sanitario del matadero",
        state: "Estado del producto",
        stateOk: "Correcto",
        stateBad: "Incorrecto (olor, color, envase)",
      },
      coldRooms: {
        name: "Temperatura de cámaras",
        room: "Cámara",
        rooms: ["Cámara 1 · canales", "Cámara 2 · producto terminado", "Cámara 3 · materia prima"],
      },
      drying: {
        name: "Curva de secaderos",
        dryer: "Secadero",
        dryers: ["Secadero 1", "Secadero 2"],
        humidity: "Humedad relativa",
        aw: "aw al salir",
        ph: "pH al salir",
      },
      cooking: { name: "Cocción", core: "Temperatura en el centro del producto" },
      cooling: { name: "Enfriamiento", after6h: "Temperatura a las 6 horas" },
      metal: {
        name: "Detector de metales",
        line: "Línea",
        lines: ["Línea 1", "Línea 2", "Línea 3"],
        pieces: "Piezas patrón detectadas y rechazadas",
        fe: "Férrico 2,0 mm",
        nonFe: "No férrico 2,5 mm",
        steel: "Acero inoxidable 3,0 mm",
      },
    },
    ccps: {
      reception: {
        step: "Recepción",
        hazard: "Crecimiento de patógenos (Salmonella, Listeria) por rotura de la cadena de frío.",
        limit: "Carne fresca ≤ 7 °C; despojos ≤ 3 °C",
        frequency: "Cada entrada",
        corrective: "Rechazar la partida o retenerla y avisar al proveedor; abrir no conformidad.",
        verification: "Revisión semanal de los registros; calibración trimestral del termómetro.",
      },
      coldRooms: {
        step: "Almacenamiento en frío",
        hazard: "Crecimiento de patógenos por temperatura de cámara alta.",
        limit: "0 a 4 °C",
        frequency: "Dos veces al día",
        corrective:
          "Revisar la cámara, trasladar el producto y evaluar su destino; abrir no conformidad.",
        verification: "Revisión diaria de los registros y del registrador continuo.",
      },
      drying: {
        step: "Secado y curado",
        hazard:
          "Supervivencia de patógenos si el producto no alcanza la aw y el pH de estabilidad.",
        limit: "aw ≤ 0,92 y pH ≤ 5,3 al salir del secadero",
        frequency: "Cada lote al salir",
        corrective: "Prolongar el secado y volver a medir; retener el lote hasta cumplir.",
        verification: "Análisis mensual de aw y pH en laboratorio externo.",
      },
      cooking: {
        step: "Cocción",
        hazard: "Supervivencia de Listeria y Salmonella por cocción insuficiente.",
        limit: "≥ 72 °C en el centro del producto",
        frequency: "Cada lote",
        corrective: "Prolongar la cocción hasta el límite; retener el lote y abrir no conformidad.",
        verification: "Calibración mensual de las sondas; revisión diaria de los registros.",
      },
      cooling: {
        step: "Enfriamiento",
        hazard: "Germinación de esporas (Clostridium perfringens) por enfriamiento lento.",
        limit: "≤ 4 °C antes de 6 horas",
        frequency: "Cada lote",
        corrective: "Retener el lote y evaluar su destino; revisar el abatidor.",
        verification: "Revisión diaria de los registros y mantenimiento del abatidor.",
      },
      metal: {
        step: "Envasado",
        hazard: "Cuerpos extraños metálicos en el producto terminado.",
        limit: "Detección y rechazo de las tres piezas patrón",
        frequency: "Al empezar, cada 2 horas y al cambiar de producto",
        corrective:
          "Parar la línea, retener lo producido desde la última verificación correcta y reinspeccionarlo.",
        verification: "Revisión diaria de los registros; mantenimiento anual del detector.",
      },
    },
  },
  /** Phase 3 (docs/spec/calidad.md, «Fase 3»): audits and their findings. */
  auditSchemes: {
    INTERNAL: "Interna",
    IFS8: "IFS Food 8",
    BRCGS9: "BRCGS Food Safety 9",
    CLIENT: "De cliente",
    OFFICIAL: "Inspección oficial",
    OTHER: "Otra externa",
  },
  chapters: {
    IFS8: [
      "Gobernanza y compromiso",
      "Sistema de gestión de la calidad y la seguridad alimentaria",
      "Gestión de recursos",
      "Planificación y proceso de producción",
      "Mediciones, análisis y mejoras",
      "Food defense",
    ],
    BRCGS9: [
      "Compromiso de la dirección y cultura",
      "Plan de seguridad alimentaria (APPCC)",
      "Sistema de gestión de la calidad y la seguridad alimentaria",
      "Normas del establecimiento",
      "Control del producto",
      "Control de procesos",
      "Personal",
      "Zonas de producción de riesgo",
      "Productos comercializados",
    ],
  },
  findingTitle: (clause: string, text: string) => `Cláusula ${clause}: ${text}`,
  auditWhat: (title: string) => `Auditoría: ${title}`,
  auditMessages: {
    notPlanned: "La auditoría ya está cerrada o anulada.",
    roomNotFound: "La sala de auditoría no existe o no la ves.",
    chapterInvalid: "Hay capítulos que no son de las normas de la empresa.",
    hasNc: "El hallazgo ya tiene su no conformidad.",
  },
  /** Phase 4 (docs/spec/calidad.md, «Fase 4»): suppliers. */
  suppliersFolder: "Proveedores",
  supplierDocWhat: (supplier: string, doc: string) => `${supplier}: ${doc}`,
  supplierReviewWhat: (supplier: string) => `Evaluar al proveedor ${supplier}`,
  supplierMessages: {
    nameTaken: "Ya hay un proveedor con ese nombre.",
    archived: "El proveedor está archivado.",
    fileNotInFolder: "El archivo tiene que estar en la carpeta del proveedor.",
    supplierNeedsOrigin: "Solo una no conformidad de origen «Proveedor» se liga a un proveedor.",
    scoresInvalid: "Cada puntuación va de 1 a 5.",
  },
  /** Phase 5 (docs/spec/calidad.md, «Fase 5»): complaints and recall. */
  complaintCategories: {
    FOREIGN_BODY: "Cuerpo extraño",
    ALLERGEN: "Alérgeno",
    MICROBIOLOGICAL: "Microbiológica",
    QUALITY: "Calidad del producto",
    LABELLING: "Etiquetado",
    PACKAGING: "Envase",
    OTHER: "Otra",
  },
  complaintNcTitle: (category: string, product: string) => `Reclamación · ${category}: ${product}`,
  complaintNcDescription: (from: string, product: string, lot: string, text: string) =>
    `Reclamación de ${from} sobre ${product}${lot === "" ? "" : ` (lote ${lot})`}: ${text}`,
  complaintWhat: (from: string, product: string) =>
    `Responder la reclamación de ${from} (${product})`,
  recallWhat: "Hacer la prueba anual de retirada",
  complaintMessages: {
    closed: "La reclamación está cerrada.",
    hasNc: "La reclamación ya tiene su no conformidad.",
    alreadyMember: "La persona ya está en el equipo de crisis.",
  },
  csv: {
    fileName: "no-conformidades.csv",
    code: "Código",
    title: "Título",
    origin: "Origen",
    severity: "Gravedad",
    status: "Estado",
    detectedOn: "Detectada el",
    owner: "Responsable",
    department: "Departamento",
    actions: "Acciones",
    actionsOpen: "Acciones pendientes",
    rootCause: "Causa raíz",
    closedOn: "Cerrada el",
  },
} as const;
