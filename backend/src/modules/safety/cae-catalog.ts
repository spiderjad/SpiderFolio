// The default catalog of documents asked of contractors (docs/spec/cae.md, «Catálogo por defecto»):
// what each one is about, how long it lasts and which companies it applies to. The names come from
// i18n (`caeTexts.catalog`), in the company's language and with its country's terms.
import type { CaeAppliesTo, CaeScope } from "../../generated/prisma/client.ts";
import type { SafetySettings } from "../workspaces/settings.ts";

interface DefaultRequirement<K extends string> {
  key: K;
  scope: CaeScope;
  validityMonths: number | null;
  appliesTo: CaeAppliesTo;
}

/** Spain: Ley 31/1995, art. 24, and RD 171/2004. A concurrent company only owes two of them. */
const spain = [
  { key: "liabilityInsurance", scope: "COMPANY", validityMonths: 12, appliesTo: "CONTRACTOR" },
  { key: "socialSecurityCert", scope: "COMPANY", validityMonths: 1, appliesTo: "CONTRACTOR" },
  { key: "taxCert", scope: "COMPANY", validityMonths: 12, appliesTo: "CONTRACTOR" },
  { key: "preventiveModality", scope: "COMPANY", validityMonths: null, appliesTo: "ALL" },
  { key: "riskAssessment", scope: "COMPANY", validityMonths: null, appliesTo: "ALL" },
  { key: "preventivePlanning", scope: "COMPANY", validityMonths: null, appliesTo: "CONTRACTOR" },
  { key: "workerList", scope: "COMPANY", validityMonths: 1, appliesTo: "CONTRACTOR" },
  { key: "prlTraining", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
  // Only that it was presented and until when: never the result nor medical restrictions.
  { key: "medicalFitness", scope: "WORKER", validityMonths: 12, appliesTo: "ALL" },
  { key: "ppeHandout", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
  { key: "socialSecurityRegistration", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
  { key: "siteRiskInfo", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
] as const satisfies readonly DefaultRequirement<string>[];

/** Latin America: the generic equivalents. */
const latam = [
  { key: "liabilityInsurance", scope: "COMPANY", validityMonths: 12, appliesTo: "CONTRACTOR" },
  { key: "socialSecurityPayment", scope: "COMPANY", validityMonths: 1, appliesTo: "CONTRACTOR" },
  { key: "riskMatrix", scope: "COMPANY", validityMonths: null, appliesTo: "ALL" },
  { key: "sstProgram", scope: "COMPANY", validityMonths: null, appliesTo: "ALL" },
  { key: "sstTraining", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
  { key: "medicalFitness", scope: "WORKER", validityMonths: 12, appliesTo: "ALL" },
  { key: "ppeHandout", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
  { key: "socialSecurityAffiliation", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
  { key: "siteInduction", scope: "WORKER", validityMonths: null, appliesTo: "ALL" },
] as const satisfies readonly DefaultRequirement<string>[];

export const defaultCatalog = { es: spain, latam } as const satisfies Record<
  SafetySettings["terms"],
  readonly DefaultRequirement<string>[]
>;
