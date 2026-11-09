// Server-wide limits, the same for every company (not in Workspace.limits): they protect the server
// itself, not a company's usage.

/** Signed plugin packages (.sfplugin) uploaded from Admin › License and plugins. */
export const pluginPackageLimits = {
  /** The uploaded file (compressed). */
  maxBytes: 50 * 1024 * 1024,
  /** Everything inside once unpacked. */
  maxUnpackedBytes: 200 * 1024 * 1024,
  maxFiles: 2000,
} as const;

/** Signing in with a company's directory (plugin auth providers, docs/spec/plugins.md). */
export const directorySignInLimits = {
  /**
   * Days a directory still signs people in after the license that includes it expires, so nobody is
   * locked out overnight. Its sync stops at once; 0 turns the grace period off.
   */
  graceDays: 7,
  /** Minutes to come back from the identity provider (OIDC) after leaving for it. */
  flowMinutes: 10,
  /** Shortest time a directory sign-in answers in, right or wrong (it doesn't reveal which). */
  minResponseMs: 600,
} as const;

/** CAE (docs/spec/cae.md): information for contractors and work permits. */
export const caeLimits = {
  /** Controlled documents handed to every contractor. */
  infoMaxDocuments: 50,
  /** The longest a work permit lasts, in days (it's renewed with a new one). */
  permitMaxDays: 7,
  /** People in one work permit (contractors' workers plus own staff). */
  permitMaxPeople: 50,
  /** Precautions in one permit's checklist. */
  permitMaxPrecautions: 40,
  /** The longest a contractor's portal access lasts, in days (it's issued again after). */
  portalAccessMaxDays: 180,
  /** A portal session (never past the access). */
  portalSessionHours: 4,
  /** A session's token is replaced after this many minutes of use. */
  portalRotateMinutes: 15,
  /** Wrong codes in a row before the access stops working (it has to be issued again). */
  portalMaxFailedAttempts: 10,
  /** A document uploaded through the portal (the company's own limits apply too). */
  portalMaxFileMb: 20,
} as const;

/** Environment (docs/spec/medio-ambiente.md). */
export const environmentLimits = {
  nameMax: 160,
  textMax: 4_000,
  shortMax: 120,
  /** An obligation's period, in months. */
  everyMonthsMax: 120,
  /** Maximum storage of a waste (Ley 7/2022, art. 18): hazardous, non-hazardous for recovery, for disposal. */
  storageMonthsHazardous: 6,
  storageMonthsRecovery: 24,
  storageMonthsDisposal: 12,
  storageMonthsMax: 36,
  /** Notices before a permit, an obligation or an authorization expires. */
  noticeDays: [60, 30, 7, 0],
  /** Notices before a waste reaches its maximum storage time. */
  storageNoticeDays: [30, 7, 0],
  /** The chronological record and the SANDACH register are exported at most this many rows at once. */
  exportMaxRows: 20_000,
  quantityMax: 1_000_000_000,
  /** The discharge analyses shown at once (newest first). */
  samplesShown: 200,
  /** Parameters of a discharge permit and values of an analysis. */
  parametersMax: 30,
} as const;

/** Whistleblowing channel (docs/spec/canal-denuncias.md, Ley 2/2023). */
export const whistleblowingLimits = {
  /** The account of what happened, and each of its other free-text fields. */
  bodyMax: 20_000,
  fieldMax: 2_000,
  contactMax: 300,
  /** A message between the reporter and management, a note or a decision. */
  messageMax: 5_000,
  categoryMax: 80,
  categoriesMax: 30,
  /** The page's own texts (the external channels, an introduction). */
  pageTextMax: 4_000,
  /** The reporter's mailbox password. */
  passwordMin: 10,
  passwordMax: 200,
  /** Wrong passwords in a row before the mailbox locks, and for how long. */
  maxFailedLogins: 10,
  lockHours: 24,
  /** The mailbox session ends after this many minutes without use. */
  sessionIdleMinutes: 30,
  managersMax: 20,
  /** Days to decide whether a case is admitted (orientative, shown to management). */
  admissionDays: 10,
  /** Months to answer, from the acknowledgement; and the one extension (art. 9.2.d). */
  responseMonths: 3,
  extensionMonths: 3,
  /** A case not investigated is purged this many months after it's received (art. 32.3). */
  purgeUninvestigatedMonths: 3,
  /** A closed case is kept these years by default, never more than the maximum (art. 26). */
  retentionYearsDefault: 3,
  retentionYearsMax: 10,
  /** Notices to management before the answer is due. */
  noticeDays: [30, 7, 0],
  /** Reports per address in the window (kept only in memory). */
  reportsPerHour: 5,
} as const;

/** Food quality (docs/spec/calidad.md): nonconformities and CAPA. */
export const qualityLimits = {
  /** Days from the last action done to the proposed effectiveness check. */
  verifyDaysDefault: 30,
  verifyDaysMin: 1,
  verifyDaysMax: 365,
  /** Lines of a «5 whys» analysis. */
  whysMax: 7,
  /** Characters of each free text. */
  titleMax: 160,
  descriptionMax: 4000,
  analysisMax: 2000,
  actionMax: 1000,
  /** Actions in one nonconformity. */
  actionsPerNc: 50,
  /** Rows in a CSV export. */
  csvMax: 10_000,
  /** Days to answer a complaint (phase 5). */
  responseDaysDefault: 10,
  responseDaysMin: 1,
  responseDaysMax: 90,
  /** Phase 6c: a culture survey's results only show from this many answers (anonymity). */
  surveyMinAnswers: 5,
  surveyQuestionsMax: 20,
  surveyQuestionMax: 200,
  objectivesMax: 4000,
  /** Phase 7: how deep and how wide a trace goes before it says it was cut. */
  traceDepth: 20,
  traceLots: 2000,
  /** Rows of one traceability CSV import (the body is at most 1 MB). */
  traceImportRows: 5000,
  traceImportChars: 900_000,
} as const;

/** Company templates (docs/spec/plantillas.md): how big a saved tree can be. */
export const templateLimits = {
  /** Folders and pages in one template. */
  nodesMax: 300,
  /** Levels below the template's root. */
  depthMax: 10,
  nameMax: 120,
  descriptionMax: 1000,
  categoryMax: 60,
  /** Images copied with one template. */
  imagesMax: 200,
  /** Categories offered in the filter. */
  categoriesMax: 100,
} as const;

/** Controlled documents: the master list downloaded as CSV or PDF. */
export const documentLimits = {
  masterListMax: 10_000,
} as const;
