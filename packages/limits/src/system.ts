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
