// Texts of Security, the legal pages and the language chooser, in English.
import { REPO_URL, SITE } from "../../config/site.ts";
import type { pages as esPages } from "../es/pages.ts";
import type { Catalog, LegalPage } from "../types.ts";

const mail = (address: string) => ({ text: address, href: `mailto:${address}` });

const legalNotice: LegalPage = {
  title: "Legal notice",
  description: `Owner of ${SITE.domain} and terms of this informational website.`,
  sections: [
    {
      heading: "Owner",
      paragraphs: [
        `This website (${SITE.domain}) belongs to ${SITE.owner}, owner of the ${SITE.name} project.`,
        ["Contact: ", mail(SITE.contactEmail), "."],
      ],
    },
    {
      heading: "Purpose",
      paragraphs: [
        `It is the informational website of ${SITE.name}, an open source project: it explains what the software does, how to install it and which optional plugins and services exist. It has no shop, user accounts or forms.`,
      ],
    },
    {
      heading: "Intellectual property",
      paragraphs: [
        [
          `The ${SITE.name} code is published under the `,
          { text: "AGPLv3 license", href: "https://www.gnu.org/licenses/agpl-3.0.html" },
          `. The texts, design and ${SITE.name} brand on this website belong to the owner, unless stated otherwise.`,
        ],
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "The content is provided for information purposes and is reviewed with care, but it may contain errors or omissions. Links to third-party sites (for example, GitHub) are provided for convenience: the owner is not responsible for their content.",
      ],
    },
    {
      heading: "Governing law",
      paragraphs: ["This website is governed by Spanish law."],
    },
  ],
};

const privacy: LegalPage = {
  title: "Privacy policy",
  description:
    "What data this website processes, why, for how long and how to exercise your rights.",
  sections: [
    {
      heading: "Controller",
      paragraphs: [
        ["The data controller is ", SITE.owner, ". Contact: ", mail(SITE.contactEmail), "."],
      ],
    },
    {
      heading: "What data we process",
      paragraphs: [
        [
          "Emails you send to ",
          mail(SITE.contactEmail),
          " or ",
          mail(SITE.securityEmail),
          ": your address, your name and whatever you write. We use them only to reply to you and keep them until your request is resolved. Legal basis: your consent when you write to us and our legitimate interest in answering your request.",
        ],
        "Hosting technical logs: the provider that hosts the website (Hostinger) logs data from each visit, such as the IP address, the date and the page requested, for the security and operation of the service. It keeps them according to its own policy. Legal basis: legitimate interest in keeping the website secure.",
        "The website has no forms, accounts or analytics, and it doesn't use cookies.",
      ],
    },
    {
      heading: `${SITE.name} installations`,
      paragraphs: [
        `Self-hosted ${SITE.name} sends no data to the owner. Each company that installs it on its server is the controller of the data it processes with it (accounts, documents and logs), and privacy requests about that data go to that company.`,
        "If a company turns on Bian, the assistant, the document excerpts in each question are sent to Anthropic with that company's own key: that transfer is also the company's responsibility.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        [
          "You can exercise your rights of access, rectification, erasure, objection, restriction of processing and portability by writing to ",
          mail(SITE.contactEmail),
          ". If you think we didn't handle your request properly, you can file a complaint with the ",
          { text: "Spanish Data Protection Agency (AEPD)", href: "https://www.aepd.es" },
          ".",
        ],
      ],
    },
  ],
};

const terms: LegalPage = {
  title: "Terms of use",
  description: "Terms of use of this website, software license and brand.",
  sections: [
    {
      heading: "Use of the website",
      paragraphs: [
        `${SITE.domain} is an informational website. You can browse it freely; you may not use it for unlawful purposes or try to disrupt it.`,
      ],
    },
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
        'It is provided "as is", without warranties of any kind, under the terms of the license. Each installation is operated by whoever installs it, who is responsible for its data, security and backups.',
      ],
    },
    {
      heading: "Brand",
      paragraphs: [
        `The ${SITE.name} name and logo belong to the owner and identify the project. The software license grants no right to use them: a modified version that is distributed or offered as a service cannot present itself as the official one.`,
      ],
    },
    {
      heading: "Plugins and services",
      paragraphs: [
        "Commercial plugins and services are not part of the free software: they are governed by their own terms, agreed when you purchase them.",
      ],
    },
    {
      heading: "Governing law",
      paragraphs: ["These terms are governed by Spanish law."],
    },
  ],
};

const cookies: LegalPage = {
  title: "Cookie policy",
  description: "This website doesn't use cookies.",
  sections: [
    {
      heading: "",
      paragraphs: [
        `The ${SITE.name} website doesn't use cookies: neither its own nor third-party, neither analytics nor advertising. That's why it shows no consent banner.`,
        "It only stores two preferences you choose in your browser (local storage): light or dark theme and language. They don't identify you or leave your browser, and they are exempt from consent because they only remember what you asked for. You can delete them at any time from your browser settings.",
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
    updated: (date: string) => `Last updated: ${date}`,
    legalNotice,
    privacy,
    terms,
    cookies,
  },
  chooser: {
    title: "Choose your language",
    action: "Continue in English",
  },
};
