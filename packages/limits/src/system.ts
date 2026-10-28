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
