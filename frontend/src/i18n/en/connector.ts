// Texts of the connector for Claude (docs/spec/conector-mcp.md): the consent screen, My profile ›
// Connected apps and the card in Administration › Security.
import type { connectorTexts as es } from "../es/connector";

export const connectorTexts: typeof es = {
  consent: {
    title: "Connect an app",
    subtitle: "An app wants to use SpiderFolio on your behalf.",
    loading: "Loading…",
    app: (name: string) => `«${name}» wants to access SpiderFolio as you`,
    redirect: (host: string) => `When you're done it sends you back to ${host}.`,
    verified: "It identifies itself with a document published by its author.",
    loopback:
      "This app only goes back to your own computer (localhost). Allow it only if you just started the connection yourself, from a program you know.",
    company: "Company",
    companyHelp:
      "The app can only use this company, with your permissions in it. For another company, connect it again.",
    noCompanies:
      "You have no company where the connector for Claude can be used: it has to be installed and on, and guests can't use it.",
    willRead: "Search and read the documents and files you can access.",
    willWrite:
      "Create and edit pages, folders and files where you can edit, comment and send for review.",
    readOnly: "In this company it can only read.",
    never:
      "It can never publish or approve documents, confirm readings for you, delete, change permissions or settings.",
    revokeHint: "You can disconnect it at any time in My profile › Connected apps.",
    allow: "Allow",
    deny: "Cancel",
    sending: "One moment…",
    errors: {
      invalid_client: "The app that asked to connect isn't recognized.",
      invalid_redirect_uri: "The app asked to go back to an address it hasn't registered.",
      invalid_request: "The connection request isn't valid. Try again from the app.",
      expired: "The connection request expired. Try again from the app.",
      missing: "There's no connection request. Start from the app you want to connect.",
    },
  },
  profile: {
    title: "Connected apps",
    text: "Apps such as Claude that use SpiderFolio on your behalf in this company, with your permissions.",
    urlLabel: "URL to connect Claude",
    urlHelp: "In Claude: Customize › Connectors › Add custom connector, and paste this address.",
    copy: "Copy",
    copied: "URL copied",
    unavailable: "The connector for Claude isn't available in this company.",
    disabled: "The owner turned the connector for Claude off in this company.",
    empty: "You have no connected apps.",
    connectedAt: (date: string) => `Connected on ${date}`,
    lastUsed: (date: string) => `last used: ${date}`,
    neverUsed: "not used yet",
    scopes: { read: "Read", write: "Read and edit" },
    disconnect: "Disconnect",
    confirmTitle: (name: string) => `Disconnect «${name}»?`,
    confirmText: "The app loses access at once. To use it again, connect it again from the app.",
    disconnected: "App disconnected",
  },
  admin: {
    title: "Connector for Claude",
    text: "Each person can connect their Claude with their own permissions. Here you see every connection in the company and can cut them.",
    enabled: "Connector on in the company",
    enabledHint: "Off: new connections and calls from existing ones are refused at once.",
    writeOn: "Claude can read and edit (Connector for Claude: editing).",
    readOnly: "Claude can only read (Connector for Claude).",
    unavailable:
      "Install «Connector for Claude» (free) from License and plugins so people can connect Claude.",
    empty: "Nobody has connected an app yet.",
    person: "Person",
  },
};
