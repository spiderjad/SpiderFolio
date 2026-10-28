// Bian's recorded answer, shared by the clip (clips.ts) and the screenshot (capturas.ts): the same
// question, answer and citation, streamed in the page by fakeBian. Nothing calls the Anthropic API.
import type { Route } from "@playwright/test";
import type pg from "pg";
import type { Ids, Locale } from "./demo-app.ts";

/** Texts of the app (frontend/src/i18n/<lang>) and of the recorded answer. */
export const BIAN_TEXT: Record<
  Locale,
  {
    ask: string;
    placeholder: string;
    question: string;
    answer: string;
    heading: string;
    quote: string;
    source: string;
  }
> = {
  es: {
    ask: "Pregúntale a Bian",
    placeholder: "Escribe tu pregunta…",
    question: "¿Qué hay que hacer antes de usar la cortadora?",
    answer:
      "Antes de empezar, comprueba que la protección de la cuchilla está colocada y usa el guante de malla en la mano que sujeta la pieza [1]. El grosor se ajusta siempre con la máquina parada, y para limpiarla hay que apagarla y desenchufarla [1].",
    heading: "Antes de empezar",
    quote: "Comprobar que la protección de la cuchilla está colocada.",
    source: "Fuente 1",
  },
  en: {
    ask: "Ask Bian",
    placeholder: "Type your question…",
    question: "What do I have to do before using the slicer?",
    answer:
      "Before you start, check that the blade guard is in place and wear a mesh glove on the hand that holds the piece [1]. Adjust the thickness only with the machine stopped, and switch it off and unplug it before cleaning [1].",
    heading: "Before you start",
    quote: "Check that the blade guard is in place.",
    source: "Source 1",
  },
};

export interface BianRecording {
  answer: string;
  done: Record<string, unknown>;
}

/** Bian's recorded answer, citing the real slicer page of the demo. */
export async function bianRecording(
  db: pg.Client,
  locale: Locale,
  ids: Ids,
): Promise<BianRecording> {
  const t = BIAN_TEXT[locale];
  const { rows } = await db.query<{ name: string; parentId: string | null; code: string | null }>(
    `SELECT n.name, n."parentId", c.code FROM "Node" n
       LEFT JOIN "ControlledDocument" c ON c."nodeId" = n.id WHERE n.id = $1`,
    [ids.slicer],
  );
  const slicer = rows[0];
  if (slicer === undefined) throw new Error("No encontré la página de la cortadora");
  const usage = {
    used: 4,
    limit: null,
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    personal: { used: 1, limit: null, blocked: false, source: "none" },
    remaining: null,
  };
  return {
    answer: t.answer,
    done: {
      type: "done",
      outcome: "answered",
      answer: t.answer,
      usage,
      sources: [
        {
          n: 1,
          chunkId: "clip-1",
          nodeId: ids.slicer,
          nodeType: "PAGE",
          title: slicer.name,
          code: slicer.code,
          version: 1,
          heading: t.heading,
          seq: 0,
          spaceId: ids.procedures,
          parentId: slicer.parentId,
          quote: t.quote,
        },
      ],
    },
  };
}

/**
 * In the page: /bian/ask answers with the recording, a few words every 70 ms, like the real stream
 * (events "delta", then "done"). Nothing reaches the server.
 */
export function fakeBian(recording: BianRecording): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/bian/ask")) return realFetch(input, init);
    const encoder = new TextEncoder();
    const words = recording.answer.split(/(?<= )/u);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        send({ type: "status", phase: "writing" });
        await new Promise((resolve) => setTimeout(resolve, 600));
        for (let i = 0; i < words.length; i += 2) {
          send({ type: "delta", text: words.slice(i, i + 2).join("") });
          await new Promise((resolve) => setTimeout(resolve, 70));
        }
        send(recording.done);
        controller.close();
      },
    });
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
  };
}

/** The usage endpoint the page asks; routed so Bian shows as available. */
export const BIAN_USAGE = "**/bian/usage";

/** Bian shows as available with room for questions (the demo server runs with it turned off). */
export function fakeBianUsage(recording: BianRecording): (route: Route) => Promise<void> {
  return (route) =>
    route.fulfill({
      json: { availability: { available: true }, usage: recording.done.usage },
    });
}
