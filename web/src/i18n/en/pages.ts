// Texts of Security, the legal pages and the language chooser, in English.
import { REPO_URL, SITE } from "../../config/site.ts";
import type { pages as esPages } from "../es/pages.ts";
import type { Catalog, LegalPage } from "../types.ts";

const privacy: LegalPage = {
  title: "Privacy policy",
  description:
    "What data this website processes and who is responsible for the data in each installation.",
  sections: [
    {
      heading: "This website",
      paragraphs: [
        `${SITE.domain} is the informational website of ${SITE.name}, run by ${SITE.owner}, its owner and data controller. It has no accounts or forms: it does not collect personal data, except what you send us by email (for example, when asking about a plugin), which we use only to reply to you. Analytics, if any, are cookieless and contain no personal data.`,
      ],
    },
    {
      heading: `${SITE.name} installations`,
      paragraphs: [
        `${SITE.name} is installed on each company's own server. The data in each installation (accounts, documents, logs) is processed by the company that runs it, which is the data controller: it does not go through our servers and we have no access to it. Privacy requests about that data should be sent to that company.`,
      ],
    },
    {
      heading: "Plugin licenses",
      paragraphs: [
        "Plugin licenses are verified offline: the software does not send us any usage data. When you purchase a plugin we process the billing and contact details of the customer company. [LEGAL BASIS AND RETENTION PERIODS]",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "You can request access to, correction of or deletion of the data you have sent us. Applicable framework: GDPR (EU) and Law 25,326 (Argentina).",
      ],
    },
    { heading: "Contact", paragraphs: [SITE.contactEmail] },
  ],
};

const terms: LegalPage = {
  title: "License and terms",
  description: "Software license, commercial plugins and use of this website.",
  sections: [
    {
      heading: "The software",
      paragraphs: [
        [
          `${SITE.name} is free software under the `,
          {
            text: "GNU Affero General Public License v3.0",
            href: "https://www.gnu.org/licenses/agpl-3.0.html",
          },
          ". You can use, study, modify and distribute it under that license; if you offer a modified version to other people over a network, you must also offer them its source code. The full text is in the ",
          { text: "repository", href: `${REPO_URL}/blob/main/LICENSE` },
          ".",
        ],
        "It is provided “as is”, without warranty, under the terms of the license. Each installation is operated by whoever installs it, who is responsible for its data, its security and its backups.",
      ],
    },
    {
      heading: "Commercial plugins",
      paragraphs: [
        "Commercial plugins are not part of the free software: they are governed by their own license agreement, signed when you purchase them. [PLUGIN TERMS: PRICE, TERM, RENEWAL, SUPPORT AND GOVERNING LAW]",
      ],
    },
    {
      heading: "Trademark",
      paragraphs: [
        `The ${SITE.name} name and logo identify the project. A modified version that is distributed or offered as a service may not present itself as the official one. [TRADEMARK POLICY]`,
      ],
    },
    {
      heading: "This website",
      paragraphs: [
        `${SITE.domain} is the project's informational website, run by ${SITE.owner}. Its content is provided for information only. [GOVERNING LAW AND JURISDICTION]`,
      ],
    },
  ],
};

const cookies: LegalPage = {
  title: "Cookie policy",
  description: "Which cookies this website uses.",
  sections: [
    {
      heading: "",
      paragraphs: [
        `The ${SITE.name} public website only uses essential storage: it saves your light or dark theme preference and the language you chose in your browser. It does not use tracking or advertising cookies, which is why it does not show a consent banner.`,
        "If non-essential cookies are added in the future, this policy will be updated and your consent will be requested before using them.",
      ],
    },
  ],
};

export const pages: Catalog<typeof esPages> = {
  security: {
    title: "Security",
    description: `How ${SITE.name} protects your company's information and what to look after in your installation.`,
    eyebrow: "Security",
    heading: "Your internal documentation, protected",
    intro: `${SITE.name} runs on your server. This is what the software does to protect your company's information, and what is up to you.`,
    blocks: [
      {
        icon: "globe",
        title: "On your server",
        text: "The database, files and backups stay on your infrastructure, in the country and with the provider you choose. Nothing goes through our servers.",
      },
      {
        icon: "shield",
        title: "Isolation between companies",
        text: "Every database query is limited to the company of the person making it, and an automated test checks that one company never sees another's data.",
      },
      {
        icon: "users",
        title: "Permissions that explain themselves",
        text: "Access is given to departments and roles. On every folder, file and page you can see who has access and why. Permissions are always checked on the server.",
      },
      {
        icon: "lock",
        title: "Protected accounts",
        text: "Passwords hashed with Argon2, two-step verification with recovery codes, revocable sessions, sign-in alerts and attempt limits.",
      },
      {
        icon: "file-check",
        title: "Audit log",
        text: "A tamper-proof log of what happens in the company: access, permission changes, approvals and reads, exportable for an audit.",
      },
      {
        icon: "book",
        title: "Open source",
        text: "You can read and audit all of the code. Each installation's secrets (2FA, your own SMTP) are encrypted with keys only your server has.",
      },
    ],
    yourPartTitle: "What is up to you",
    yourPart: [
      "HTTPS (the https profile sets it up automatically with a domain)",
      "Keeping up to date with the latest version",
      "Daily off-server backups, and testing that restoring works",
      "A firewall with only ports 80 and 443 open (and key-based SSH)",
      "Keeping the .env file somewhere safe",
    ],
    dataNote:
      "If you turn on Bian, the document excerpts for each request are sent to the Anthropic API with your own key. If you use Sentry, error events carry no personal data.",
    reportTitle: "Report a vulnerability",
    report: [
      "Don't open a public issue: follow the repository's ",
      { text: "security policy", href: `${REPO_URL}/security/policy` },
      ".",
    ],
  },
  legal: {
    eyebrow: "Legal",
    draft: "Draft pending professional review. This is not the final legal text.",
    privacy,
    terms,
    cookies,
  },
  chooser: {
    title: "Choose your language",
    action: "Continue in English",
  },
};
