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
