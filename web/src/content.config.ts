import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const docGroups = [
  "empezar",
  "uso-diario",
  "administracion",
  "seguridad",
  "autoalojamiento",
  "desarrolladores",
] as const;

const docs = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    group: z.enum(docGroups),
    order: z.number(),
    icon: z.string(),
  }),
});

export const collections = { docs };
