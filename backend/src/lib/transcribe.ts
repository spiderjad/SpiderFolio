// Audio → text with a self-hosted Whisper (openai-whisper-asr-webservice, WHISPER_URL): the audio never
// leaves the installation. Used by Maintenance to report and close work orders by talking
// (docs/spec/mantenimiento.md, section 3). The container converts any format the browsers record
// (WebM/Opus, Ogg, MP4/AAC) with its ffmpeg (encode=true).
import { z } from "zod";

const ResponseSchema = z.object({ text: z.string() });

export interface TranscribeInput {
  audio: Buffer;
  contentType: string;
  /** The person's language («es», «en»): Whisper guesses worse on short notes. */
  language: string;
}

export class TranscriptionError extends Error {}

export async function transcribeAudio(
  whisperUrl: string,
  input: TranscribeInput,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL("/asr", whisperUrl);
  url.searchParams.set("task", "transcribe");
  url.searchParams.set("language", input.language);
  url.searchParams.set("output", "json");
  url.searchParams.set("encode", "true");
  const form = new FormData();
  form.append(
    "audio_file",
    new Blob([new Uint8Array(input.audio)], { type: input.contentType }),
    "audio",
  );
  const timeout = AbortSignal.timeout(120_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    throw new TranscriptionError("Whisper unreachable", { cause: error });
  }
  if (!response.ok) throw new TranscriptionError(`Whisper answered ${String(response.status)}`);
  const parsed = ResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new TranscriptionError("Whisper answered something else");
  return parsed.data.text.replace(/\s+/gu, " ").trim();
}
