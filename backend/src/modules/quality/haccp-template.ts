// The meat industry HACCP template (docs/spec/calidad.md, «Plantilla cárnica»): six monitoring forms with
// their limits, each linked to its critical control point. Read inside `withLocale` (the company's
// language). The limits are common examples of the industry: each company adjusts them to its plan.
import { qualityTexts } from "../../i18n/index.ts";
import type { FormField } from "../forms/forms.schemas.ts";

type Severity = "MINOR" | "MAJOR" | "CRITICAL";
type HazardType = "BIOLOGICAL" | "CHEMICAL" | "PHYSICAL" | "ALLERGEN";

export interface TemplateItem {
  form: { name: string; fields: FormField[] };
  severity: Severity;
  ccp: {
    code: string;
    name: string;
    step: string;
    hazard: string;
    hazardType: HazardType;
    criticalLimit: string;
    frequency: string;
    correctiveAction: string;
    verification: string;
  };
}

const options = (labels: readonly string[]) =>
  labels.map((label, index) => ({ id: `o${String(index + 1)}`, label }));

export function haccpTemplate(): { folder: string; items: TemplateItem[] } {
  const t = qualityTexts.template;
  const f = t.forms;
  const c = t.ccps;
  const signature: FormField = {
    id: "firma",
    type: "signature",
    label: t.signature,
    required: false,
  };
  const lot: FormField = {
    id: "lote",
    type: "text",
    label: t.lot,
    required: true,
    multiline: false,
  };
  const product: FormField = {
    id: "producto",
    type: "text",
    label: t.product,
    required: true,
    multiline: false,
  };
  const ccp = (
    code: string,
    name: string,
    texts: (typeof c)["reception"],
    hazardType: HazardType,
  ): TemplateItem["ccp"] => ({
    code,
    name,
    step: texts.step,
    hazard: texts.hazard,
    hazardType,
    criticalLimit: texts.limit,
    frequency: texts.frequency,
    correctiveAction: texts.corrective,
    verification: texts.verification,
  });
  return {
    folder: t.folder,
    items: [
      {
        severity: "MAJOR",
        form: {
          name: f.reception.name,
          fields: [
            {
              id: "proveedor",
              type: "text",
              label: f.reception.supplier,
              required: true,
              multiline: false,
            },
            lot,
            {
              id: "registro",
              type: "text",
              label: f.reception.healthNumber,
              required: true,
              multiline: false,
            },
            {
              id: "temp",
              type: "number",
              label: t.temperature,
              unit: "°C",
              required: true,
              max: 7,
            },
            {
              id: "estado",
              type: "choice",
              label: f.reception.state,
              required: true,
              options: options([f.reception.stateOk, f.reception.stateBad]),
              nonConforming: ["o2"],
            },
            signature,
          ],
        },
        ccp: ccp("PCC-1", f.reception.name, c.reception, "BIOLOGICAL"),
      },
      {
        severity: "MAJOR",
        form: {
          name: f.coldRooms.name,
          fields: [
            {
              id: "camara",
              type: "choice",
              label: f.coldRooms.room,
              required: true,
              options: options(f.coldRooms.rooms),
              nonConforming: [],
            },
            {
              id: "temp",
              type: "number",
              label: t.temperature,
              unit: "°C",
              required: true,
              min: 0,
              max: 4,
            },
            signature,
          ],
        },
        ccp: ccp("PCC-2", f.coldRooms.name, c.coldRooms, "BIOLOGICAL"),
      },
      {
        severity: "MAJOR",
        form: {
          name: f.drying.name,
          fields: [
            {
              id: "secadero",
              type: "choice",
              label: f.drying.dryer,
              required: true,
              options: options(f.drying.dryers),
              nonConforming: [],
            },
            lot,
            { id: "temp", type: "number", label: t.temperature, unit: "°C", required: true },
            {
              id: "humedad",
              type: "number",
              label: f.drying.humidity,
              unit: "%",
              required: true,
            },
            { id: "aw", type: "number", label: f.drying.aw, required: false, max: 0.92 },
            { id: "ph", type: "number", label: f.drying.ph, required: false, max: 5.3 },
            signature,
          ],
        },
        ccp: ccp("PCC-3", f.drying.name, c.drying, "BIOLOGICAL"),
      },
      {
        severity: "CRITICAL",
        form: {
          name: f.cooking.name,
          fields: [
            product,
            lot,
            {
              id: "centro",
              type: "number",
              label: f.cooking.core,
              unit: "°C",
              required: true,
              min: 72,
            },
            signature,
          ],
        },
        ccp: ccp("PCC-4", f.cooking.name, c.cooking, "BIOLOGICAL"),
      },
      {
        severity: "MAJOR",
        form: {
          name: f.cooling.name,
          fields: [
            product,
            lot,
            {
              id: "seis_horas",
              type: "number",
              label: f.cooling.after6h,
              unit: "°C",
              required: true,
              max: 4,
            },
            signature,
          ],
        },
        ccp: ccp("PCC-5", f.cooling.name, c.cooling, "BIOLOGICAL"),
      },
      {
        severity: "CRITICAL",
        form: {
          name: f.metal.name,
          fields: [
            {
              id: "linea",
              type: "choice",
              label: f.metal.line,
              required: true,
              options: options(f.metal.lines),
              nonConforming: [],
            },
            {
              id: "piezas",
              type: "checklist",
              label: f.metal.pieces,
              required: true,
              items: [
                { id: "fe", label: f.metal.fe },
                { id: "nofe", label: f.metal.nonFe },
                { id: "inox", label: f.metal.steel },
              ],
            },
            signature,
          ],
        },
        ccp: ccp("PCC-6", f.metal.name, c.metal, "PHYSICAL"),
      },
    ],
  };
}
