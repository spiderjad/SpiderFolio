// License and plugins, Limits and usage, and the installation back office texts.
import type { Catalog } from "../index";
import type { licenseEs as EsLicense } from "../es/license";

export const licenseEs: Catalog<typeof EsLicense> = {
  license: {
    title: "License and plugins",
    subtitle:
      "This server's plugins. Paid ones work with your company's license; you turn the free ones on.",
    loadError: "We couldn't load the plugins",
    pluginsTitle: "Plugins",
    count: (shown: number, total: number) =>
      shown === total ? `${String(total)} installed` : `${String(shown)} of ${String(total)}`,
    search: "Search a plugin",
    noPlugins: "No plugins installed. Everything in the core works without them.",
    noMatches: "No plugin matches your search.",
    catalogLink: "Plugin catalog",
    badge: {
      paid: "Paid",
      free: "Free",
      unverified: "Unverified",
    },
    pluginState: {
      active: "Active",
      off: "Off",
      noLicense: "No license",
      expired: "License expired",
      removing: "Removed on restart",
      waiting: "Loads on restart",
    },
    replacedBy: (name: string) => `Replaced by ${name}`,
    replacedHint: (name: string) =>
      `${name} already does this and uses its data. If ${name} stops being active, this one comes back on its own.`,
    licenseLine: (id: string) => `License ${id}`,
    expires: (date: string) => `expires ${date}`,
    expiresSoon: (days: number) =>
      days <= 1 ? "expires tomorrow" : `expires in ${String(days)} days`,
    expired: (date: string) => `expired ${date}`,
    noExpiry: "no expiry",
    noLicense: "No license: ask for it with the company ID (below).",
    invalid: "The loaded license isn't valid: load the one we sent you.",
    invalidWorkspace: "The loaded license belongs to another company: load this company's.",
    guide: "Guide",
    renew: "Renew or change license",
    loadLicense: "Load license",
    enable: "Turn on",
    disable: "Turn off",
    enabled: "Plugin turned on",
    disabled: "Plugin turned off",
    remove: "Remove",
    more: (name: string) => `More actions for ${name}`,
    licenseDialog: {
      title: "Renew or change license",
      text: "Your company's license covers all its paid plugins. Paste the new one or upload the .sfplugin we sent you (the license is inside).",
      tokenLabel: "License",
      tokenHint: "The full text we sent you, starting with SFL1.",
      save: "Save license",
      saving: "Saving…",
      saved: "License saved",
      removeLicense: "Remove the license",
      removeTitle: "Remove the license?",
      removeText:
        "Paid plugins stop working in this company. Their settings are kept in case you load it again.",
      removing: "Removing…",
      removed: "License removed",
    },
    removeDialog: {
      title: (name: string) => `Remove "${name}" from the server?`,
      text: "It stops loading on the next restart. Its data and settings are kept: if you upload it again, it comes back as it was.",
      scheduled: "The restart is scheduled on its own, in 1 minute, warning whoever is signed in.",
      manual:
        "This server doesn't restart on its own: whoever runs it restarts the app and the worker.",
      multiCompany: "It's removed for every company on this server.",
      licenseKept: "The license doesn't change.",
      confirm: "Remove from the server",
      pending: "Removing…",
      done: (name: string) => `${name} is removed on the next restart`,
    },
    community: {
      hint: "Third-party: SpiderJAD didn't review or sign it.",
      confirmTitle: (name: string) => `Turn on "${name}"?`,
      confirmText:
        "It isn't verified and runs inside this server, with access to the data of all its companies. Turn it on only if you trust whoever made it.",
      confirm: "Turn on anyway",
      enabling: "Turning on…",
    },
    company: {
      label: "Company ID",
      hint: "Send it to us to issue the license: it only works with this ID.",
      copy: "Copy",
      copied: "ID copied",
    },
    upload: {
      choose: "Upload plugin",
      uploading: "Checking…",
      uploaded: (name: string, version: string) => `${name} ${version} installed`,
      hint: "A .sfplugin signed by SpiderJAD: the one we sent you or a free one from the catalog.",
      needsMfa:
        "To upload or remove plugins, turn on two-step verification (My profile › Security).",
      multiCompany: "This server has several companies: plugins belong to the whole server.",
    },
    restart: {
      waiting: (count: number) =>
        count === 1
          ? "One change applies on restart."
          : `${String(count)} changes apply on restart.`,
      now: "Restart now",
      confirmTitle: "Restart now?",
      confirmText:
        "The app and the worker restart in 1 minute. We warn whoever is signed in so they save, and the app comes back on its own in a few seconds.",
      confirm: "Restart in 1 minute",
      scheduling: "Scheduling…",
      scheduled: (time: string) => `Restart scheduled for ${time}.`,
      manual:
        "This server doesn't restart on its own: whoever runs it restarts the app and the worker (docker compose restart app worker).",
    },
    restartBanner: (seconds: number) =>
      seconds > 0
        ? `The app restarts in ${String(seconds)} s to load server changes. Save what you're editing.`
        : "The app is restarting. Come back in a few seconds.",
  },
  limits: {
    title: "Limits and usage",
    subtitle:
      "There are no limits by default. Set the ones that work for your company; they apply to everyone and you can change them anytime.",
    loadError: "We couldn't load the limits",
    usageTitle: "Usage",
    storage: "Storage",
    members: "People",
    membersValue: (full: string, readers: string) =>
      `${full} with a full seat · ${readers} readers`,
    aiThisMonth: "Bian questions this month",
    of: (used: string, max: string) => `${used} of ${max}`,
    unlimited: "no limit",
    limitsTitle: "Limits",
    noLimit: "No limit",
    save: "Save limits",
    saved: "Limits saved",
    readOnly: "Only people with “Company settings” can change them.",
    fields: {
      storageGb: {
        label: "Total storage",
        unit: "GB",
        hint: "Once reached, no more files can be uploaded.",
      },
      maxFileMb: { label: "Maximum file size", unit: "MB", hint: "Minimum 1 MB." },
      fileVersionsKept: {
        label: "Versions kept per file",
        unit: "versions",
        hint: "Older ones go to the version trash. Never affects the current version or controlled documents.",
      },
      auditRetentionDays: {
        label: "Keep the audit log for",
        unit: "days",
        hint: "Minimum 30 days. With no limit, everything is kept.",
      },
      aiQueriesPerMonth: {
        label: "Bian questions per month (whole company)",
        unit: "questions",
        hint: "You can also change it in Admin › Bian.",
      },
    },
  },
  internal: {
    title: "Companies on this installation",
    subtitle: "Usage and limits for each company. Counts only: never content.",
    search: "Search for a company",
    created: (date: string) => `Created: ${date}`,
    licensed: "Licensed",
    empty: "No companies match.",
    loadError: "We couldn't load the companies",
  },
};
