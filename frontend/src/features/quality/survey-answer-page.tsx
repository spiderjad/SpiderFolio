// /app/:slug/calidad/encuestas/:surveyId — answering a food safety culture survey (docs/spec/calidad.md,
// «Fase 6c»): anyone active (not a guest), once, while it's open. Anonymous: what's answered is stored
// without the person or the time. Reached from «Mis pendientes».
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Lock } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/display";
import { FormField, Textarea } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { cultureApi, cultureKeys } from "./culture-api";
import { texts } from "@/i18n";

const t = texts.quality.culture;

function Scale({
  index,
  label,
  value,
  onChange,
}: {
  index: number;
  label: string;
  value: number | undefined;
  onChange: (score: number) => void;
}) {
  const id = `statement-${String(index)}`;
  return (
    <li className="grid gap-2 border-b border-border pb-4 last:border-b-0">
      <p id={id} className="text-sm font-medium">
        {String(index + 1)}. {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <Button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${String(score)}: ${t.scale[score - 1] ?? ""}`}
            variant={value === score ? "primary" : "outline"}
            className="h-auto min-h-11 flex-col gap-0.5 px-1 py-1.5"
            onClick={() => {
              onChange(score);
            }}
          >
            <span className="text-base font-semibold tabular-nums">{score}</span>
            <span className="hidden text-[11px] leading-tight sm:block">{t.scale[score - 1]}</span>
          </Button>
        ))}
      </div>
    </li>
  );
}

export function SurveyAnswerPage() {
  const { workspaceSlug = "", surveyId = "" } = useParams();
  const a = t.answer;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: cultureKeys.answer(workspaceSlug, surveyId),
    queryFn: () => cultureApi.toAnswer(workspaceSlug, surveyId),
    select: (data) => data.survey,
  });
  const [scores, setScores] = useState<Record<number, number>>({});
  const [comment, setComment] = useState("");
  const send = useMutation({
    mutationFn: (count: number) =>
      cultureApi.answer(workspaceSlug, surveyId, {
        scores: Array.from({ length: count }, (_, index) => scores[index] ?? 0),
        comment: comment.trim() === "" ? null : comment.trim(),
      }),
    onSuccess: async () => {
      toast.success(a.sent);
      await queryClient.invalidateQueries({ queryKey: cultureKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const survey = query.data;
  const back = (
    <Button asChild variant="outline" className="justify-self-start">
      <Link to={`/app/${workspaceSlug}/pendientes`}>{a.back}</Link>
    </Button>
  );
  if (query.isError) {
    return (
      <Card className="grid gap-3 p-5">
        <p className="text-sm">{a.notFound}</p>
        {back}
      </Card>
    );
  }
  if (survey === undefined) return <Skeleton className="h-80" />;
  const done = Object.keys(scores).length;
  const total = survey.questions.length;
  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{survey.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {a.closesOn(formatUtcDate(survey.closesOn))}
        </p>
      </div>
      {survey.answered || send.isSuccess ? (
        <Card className="grid gap-3 p-5">
          <p className="flex items-center gap-2 text-sm" role="status">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            {send.isSuccess ? a.sent : a.answered}
          </p>
          {back}
        </Card>
      ) : !survey.open ? (
        <Card className="grid gap-3 p-5">
          <p className="flex items-center gap-2 text-sm">
            <Lock className="size-5 text-muted-foreground" aria-hidden="true" />
            {a.closed}
          </p>
          {back}
        </Card>
      ) : (
        <Card className="grid gap-4 p-4 sm:p-5">
          <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {a.intro}
          </p>
          <ol className="grid gap-4">
            {survey.questions.map((question, index) => (
              <Scale
                key={index}
                index={index}
                label={question}
                value={scores[index]}
                onChange={(score) => {
                  setScores({ ...scores, [index]: score });
                }}
              />
            ))}
          </ol>
          <FormField label={a.comment} hint={a.commentHint}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={1000}
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {a.progress(done, total)}
            </span>
            <Button
              disabled={done < total || send.isPending}
              onClick={() => {
                send.mutate(total);
              }}
            >
              {send.isPending ? a.sending : a.send}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
