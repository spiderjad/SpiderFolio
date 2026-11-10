// Recording a voice note (docs/spec/mantenimiento.md, section 3), for phones in the plant: one big
// button, gloves and noise in mind. With the server's Whisper it records the audio (MediaRecorder) and
// sends it; without it, it uses the browser's dictation and sends the text. Hidden when neither works.
import { useQuery } from "@tanstack/react-query";
import { Loader2, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { locale, texts } from "@/i18n";
import { maintenanceApi, maintenanceKeys, type VoiceNote } from "./maintenance-api";

const t = texts.maintenance.voice;
const MAX_SECONDS = 180;

// The Web Speech API isn't in TypeScript's DOM library: just what's used here.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionClass(): (new () => Recognition) | null {
  const scope = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Whether voice notes are offered here: Bian on for the company and a browser that can take one.
 * `serverTranscription` says how (the server's Whisper or the browser's dictation).
 */
export function useVoice(): { available: boolean; serverTranscription: boolean; ai: boolean } {
  const { workspaceSlug = "" } = useParams();
  const status = useQuery({
    queryKey: maintenanceKeys.voice(workspaceSlug),
    queryFn: () => maintenanceApi.voice(workspaceSlug),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const voice = status.data?.voice;
  const serverTranscription = voice?.serverTranscription === true;
  return {
    available: voice?.available === true && canCaptureVoice(serverTranscription),
    serverTranscription,
    // Bian is on for the company (suggesting a resolution needs no microphone).
    ai: voice?.available === true,
  };
}

const canRecord = () =>
  // Outside HTTPS there's no navigator.mediaDevices (the DOM types say otherwise).
  typeof MediaRecorder !== "undefined" &&
  "mediaDevices" in navigator &&
  typeof navigator.mediaDevices.getUserMedia === "function";

/** Whether this browser can take a voice note, with or without the server's transcription. */
export function canCaptureVoice(serverTranscription: boolean): boolean {
  return serverTranscription ? canRecord() : recognitionClass() !== null;
}

function audioType(): string {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;

export function VoiceCapture({
  serverTranscription,
  busy,
  hint,
  onNote,
}: {
  serverTranscription: boolean;
  /** The note is on its way (transcribing, preparing the proposal). */
  busy: boolean;
  hint: string;
  onNote: (note: VoiceNote) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;

  // Leaving the screen cancels a note under way (nothing is sent).
  useEffect(() => () => cancelRef.current?.(), []);

  const finish = () => {
    stopRef.current = null;
    cancelRef.current = null;
    setRecording(false);
  };

  const startAudio = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError" ? t.micDenied : t.noMic,
      );
      return;
    }
    const type = audioType();
    const recorder = new MediaRecorder(stream, type === "" ? undefined : { mimeType: type });
    const chunks: Blob[] = [];
    const started = Date.now();
    let cancelled = false;
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS && recorder.state === "recording") recorder.stop();
    }, 250);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      finish();
      if (cancelled) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
      if (blob.size === 0) {
        setError(t.nothingHeard);
        return;
      }
      onNoteRef.current({ kind: "audio", blob, durationMs: Date.now() - started });
    };
    stopRef.current = () => {
      if (recorder.state === "recording") recorder.stop();
    };
    cancelRef.current = () => {
      cancelled = true;
      if (recorder.state === "recording") recorder.stop();
    };
    recorder.start(1000);
    setRecording(true);
  };

  const startDictation = (Recognizer: new () => Recognition) => {
    const recognition = new Recognizer();
    recognition.lang = locale === "en" ? "en-GB" : "es-ES";
    recognition.continuous = true;
    recognition.interimResults = true;
    let done = "";
    let latest = "";
    let cancelled = false;
    let failed = false;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) recognition.stop();
    }, 250);
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result === undefined) continue;
        if (result.isFinal) done += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      latest = `${done}${interim}`.trim();
      setLive(latest);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      failed = true;
      setError(event.error === "not-allowed" ? t.micDenied : t.dictationFailed);
    };
    recognition.onend = () => {
      window.clearInterval(timer);
      finish();
      if (cancelled || failed) return;
      const text = latest.trim();
      if (text === "") {
        setError(t.nothingHeard);
        return;
      }
      onNoteRef.current({ kind: "text", text });
    };
    stopRef.current = () => {
      recognition.stop();
    };
    cancelRef.current = () => {
      cancelled = true;
      recognition.abort();
    };
    recognition.start();
    setRecording(true);
  };

  const start = () => {
    setError(null);
    setLive("");
    setSeconds(0);
    if (serverTranscription) {
      void startAudio();
      return;
    }
    const Recognizer = recognitionClass();
    if (Recognizer !== null) startDictation(Recognizer);
  };

  return (
    <div className="grid gap-3">
      {recording ? (
        <>
          <Button
            type="button"
            size="lg"
            variant="destructive"
            className="h-16 w-full text-base"
            onClick={() => stopRef.current?.()}
          >
            <Square className="size-5 fill-current" aria-hidden="true" />
            {t.stop}
          </Button>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-medium text-danger" aria-live="polite">
              <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
              {t.limit(clock(seconds))}
            </span>
            <button
              type="button"
              className="font-medium text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => cancelRef.current?.()}
            >
              {t.cancel}
            </button>
          </div>
          {!serverTranscription && (
            <p className="min-h-10 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {live === "" ? t.listening : live}
            </p>
          )}
        </>
      ) : (
        <>
          <Button
            type="button"
            size="lg"
            className="h-16 w-full text-base"
            disabled={busy}
            onClick={start}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Mic className="size-5" aria-hidden="true" />
            )}
            {busy ? t.working : t.record}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{hint}</p>
        </>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
