// License and plugins, Limits and usage, and the installation back office texts.
import type { Catalog } from "../index";
import type { licenseEs as EsLicense } from "../es/license";

export const licenseEs: Catalog<typeof EsLicense> = {
  license: {
    title: "License and plugins",
    subtitle:
      "SpiderFolio is open source. Paid plugins are activated with a license that's verified on this server, offline; official free ones you turn on yourself.",
    loadError: "We couldn't load the license",
    status: {
      none: "No license",
      valid: "Valid license",
      expired: "Expired license",
      invalid: "Invalid license",
    },
    customer: (name: string) => `Issued to ${name}`,
    expires: (date: string) => `Expires on ${date}`,
    noExpiry: "No expiry",
    expiredNote:
      "This license's plugins no longer apply. Their settings are kept and apply again when you load a new license.",
    invalidNote: "The saved license isn't valid: load a new one.",
    load: "Load license",
    replace: "Replace license",
    remove: "Remove license",
    removeTitle: "Remove the license?",
    removeText:
      "Plugins stop applying in this company. Their settings are kept in case you load it again.",
    removed: "License removed",
    saved: "License loaded",
    tokenLabel: "License",
    tokenHint: "Paste the full text we sent you (it starts with SFL1.).",
    save: "Save license",
    saving: "Saving…",
    cancel: "Cancel",
    pluginsTitle: "Plugins installed on this server",
    noPlugins: "This server has no plugins installed. Everything in the core works without them.",
    pluginState: {
      active: "Active",
      licensed: "In the license (expired)",
      inactive: "No license",
      off: "Off",
      replaced: (name: string) => `Replaced by ${name}`,
    },
    badge: {
      paid: "Official · Paid",
      free: "Official · Free",
    },
    freeHint: "Official free plugin, signed by SpiderJAD. You turn it on, no license needed.",
    replacedHint: (name: string) =>
      `While ${name} is active, this one stays off: ${name} already does what it does and uses the same data. If ${name} stops being active, this one works again on its own.`,
    guide: "Guide",
    community: {
      unverified: "Unverified",
      hint: "Third-party plugin: SpiderJAD hasn't reviewed or signed it.",
      enable: "Activate",
      disable: "Deactivate",
      confirmTitle: (name: string) => `Activate “${name}”?`,
      confirmText:
        "This is an unverified third-party plugin. It runs inside this server with access to its data and to every company on this installation. Only activate it if you trust whoever made it.",
      confirm: "Activate anyway",
      enabling: "Activating…",
      enabled: "Plugin activated",
      disabled: "Plugin deactivated",
    },
    catalogLink: "See the plugin catalog",
    invalidWorkspace: "The saved license belongs to another company: load this company's one.",
    company: {
      title: "Company ID",
      hint: "Send it to us to generate your company's license: it only works with this ID.",
      copy: "Copy",
      copied: "ID copied",
    },
    upload: {
      title: "Upload a plugin",
      text: "A .sfplugin file signed by SpiderJAD: the one we sent you with your company's license, or a free one downloaded from the catalog. It is verified on this server before it is installed.",
      choose: "Choose .sfplugin file",
      uploading: "Verifying and installing…",
      uploaded: (name: string, version: string) => `${name} ${version} installed`,
      needsMfa:
        "To upload plugins you need two-step verification turned on (My profile › Security).",
      multiCompany:
        "This server hosts several companies: the plugin is installed for the whole server. Each company activates it with its own license.",
      communityNote:
        "Unsigned third-party plugins aren't uploaded here: whoever runs the server copies them into the plugins folder.",
    },
    restart: {
      waiting: (list: string) => `Installed, loads on restart: ${list}.`,
      now: "Restart now",
      confirmTitle: "Restart now?",
      confirmText:
        "The app and the worker restart in 1 minute to load the plugins. Everyone signed in gets a notice to save what they're editing, and the app comes back on its own in a few seconds.",
      confirm: "Restart in 1 minute",
      scheduling: "Scheduling…",
      scheduled: (time: string) => `Restart scheduled for ${time}.`,
      manual:
        "This server doesn't restart on its own: whoever runs it restarts the app and the worker (docker compose restart app worker).",
    },
    restartBanner: (seconds: number) =>
      seconds > 0
        ? `The app restarts in ${String(seconds)} s to load server changes. Save what you're editing.`
        : "The app is restarting. It's back in a few seconds.",
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
