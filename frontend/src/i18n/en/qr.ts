// Document QR code texts (9C.6), in English. Same shape as es/qr.ts.

import type { Catalog } from "../index";
import type { qrTexts as EsQr } from "../es/qr";

export const qrTexts: Catalog<typeof EsQr> = {
  menu: "Generate QR code",
  title: (name: string) => `QR code for “${name}”`,
  text: "The code always opens the current version. Print it and post it where the document is used.",
  loadError: "Couldn’t load the QR codes.",
  empty: "There are no QR codes for this document yet.",
  generate: "Generate QR code",
  generating: "Generating…",
  generatePublic: "Generate public QR code",
  created: "QR code generated.",
  kind: { private: "Requires sign-in", public: "Public · no sign-in" },
  scans: (count: number) => (count === 1 ? "1 scan" : `${String(count)} scans`),
  lastScan: (date: string) => `last ${date}`,
  previewLabel: "QR code with the logo",
  downloadPng: "Download PNG",
  downloadSvg: "Download SVG",
  labels: "Label sheet (A4)",
  labelSizes: { small: "Small", medium: "Medium", large: "Large" },
  revoke: "Revoke",
  revokeTitle: "Revoke this QR code?",
  revokeText:
    "It stops working immediately: anyone who scans it will see it’s no longer valid. You’ll need to replace any you already printed.",
  revokeConfirm: "Revoke",
  revokePending: "Revoking…",
  revoked: "QR code revoked.",
  publicTitle: "Generate a public QR code?",
  publicText:
    "Anyone who scans the code can read this document, and only this one, without signing in. Use it for safety instructions for contractors or visitors. You can revoke it anytime.",
  publicConfirm: "Generate public QR code",
  scan: {
    opening: "Opening the document…",
    invalid: "This QR code is no longer valid.",
    invalidText: "It may have been revoked, or the document is no longer available.",
    error: "Couldn’t open the code.",
    download: "Download the file",
    publicNote: "Document shared by QR code, read-only.",
    frame: "Document",
  },
};
