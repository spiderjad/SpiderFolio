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
    warning:
      "Si no lo pediste, avisa a tu administrador y cambia tu contraseña ahora mismo.",
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
  onlyDocuments: "El QR es para páginas y archivos.",
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
  targetKinds: { space: "Espacio", FOLDER: "Carpeta", PAGE: "Página", FILE: "Archivo" },
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
    MEMBER: { name: "Miembro", description: "Usa el contenido según sus departamentos y permisos." },
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
