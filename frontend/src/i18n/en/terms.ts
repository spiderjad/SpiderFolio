// Terms and Privacy acceptance texts (sign-up, invitation and version change).

import type { Catalog } from "../index";
import type { termsTexts as EsTerms } from "../es/terms";

export const termsTexts: Catalog<typeof EsTerms> = {
  /** The checkbox is split into parts for the links: "I accept the {terms} and the {privacy}". */
  accept: {
    before: "I accept the ",
    terms: "Terms and conditions",
    middle: " and the ",
    privacy: "Privacy policy",
  },
  required: "You must accept the Terms and conditions and the Privacy policy to continue.",
  marketing: "I want to receive SpiderFolio news by email",
  gate: {
    title: "We’ve updated our terms",
    subtitle:
      "To keep using SpiderFolio, accept the current version of the Terms and conditions and the Privacy policy.",
    submit: "Accept and continue",
    submitting: "Saving…",
  },
};
