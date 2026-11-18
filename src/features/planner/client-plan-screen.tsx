import { scrollToFragment } from "@/lib/scroll-to-fragment";
import { usePortalText } from "@/hooks/use-portal-language";
import { formatRelative } from "@/lib/utils-format";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, HelpCircle, MessageSquare, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { QueryState } from "@/components/query-state";
import { ProgressBar, StatusPill, type Tone } from "@/components/status-pill";
import { PersonAvatar } from "@/components/person-avatar";
import { useAuth } from "@/components/auth-provider";
import { clientPlanQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import {
  addPlanComment,
  answerClientQuestion,
  askClientQuestion,
  deletePlanComment,
  setSectionApproval,
  setSectionClientSummary,
} from "@/lib/plan-client-view.functions";
import {
  CLIENT_COMMENT_MAX,
  CLIENT_SUMMARY_MAX,
  CLIENT_TASK_STATUS_DA,
  formatRelativeDa,
  overallProgress,
  personName,
  planStatusDa,
  questionsAwaitingClient,
  sectionPercent,
  sectionStatusDa,
  type ClientApproval,
  type ClientComment,
  type ClientQuestion,
  type ClientSection,
  type ClientTask,
  type ClientTaskStatus,
} from "@/lib/plan-client-view";
import { cn } from "@/lib/utils";
import { useServerAction } from "@/lib/use-server-action";
import { sectionColor } from "./plan-model";

const TASK_TONE: Record<ClientTaskStatus, Tone> = {
  todo: "default",
  in_progress: "info",
  waiting: "warning",
  done: "success",
};

/**
 * A plan as its clients see it, in the same columns as the agency's board: one
 * column per section, with the section's plain-language summary and progress on
 * top and its tasks as cards underneath. A card opens to everything about the
 * task: what it has to deliver, its steps, the questions put to the client, and a
 * place to ask and comment.
 *
 * Clients get the same view and control as the agency, in their preferred language and
 * without code, diffs or implementation: none of that is part of the client's
 * own wording, and a task, step or deliverable without client wording is not
 * shown. The agency opens the same screen as a preview ("View client view"), so
 * what they write is what the client reads.
 */
export function ClientPlanScreen({
  planId,
  preview = false,
  backHref,
  openTaskId = null,
  onOpenTaskChange,
}: {
  planId: string;
  /** The agency looking at what the client sees. */
  preview?: boolean;
  backHref?: { label: string; onClick: () => void };
  /** The task whose dialog is open, so it can be linked to. */
  openTaskId?: string | null;
  onOpenTaskChange?: (taskId: string | null) => void;
}) {
  const t = usePortalText();
  const query = useQuery(clientPlanQuery(planId));
  const [localTask, setLocalTask] = useState<string | null>(null);
  const activeTaskId = onOpenTaskChange ? openTaskId : localTask;
  const openTask = (taskId: string | null) =>
    onOpenTaskChange ? onOpenTaskChange(taskId) : setLocalTask(taskId);

  const unwritten =
    query.data?.plan.sections.reduce((sum, section) => sum + section.unwritten_task_count, 0) ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {preview ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-accent px-4 py-2.5 text-[13px] md:px-8">
          <span>
            <strong className="font-medium">Client view.</strong> This is what your client sees.
            Their comments, answers and approvals show up here.
            {unwritten > 0
              ? ` ${unwritten} ${unwritten === 1 ? "task is" : "tasks are"} hidden because ${unwritten === 1 ? "it has" : "they have"} no client title yet: add one under “For the client” on the task.`
              : ""}
          </span>
          {backHref ? (
            <Button type="button" size="sm" variant="outline" onClick={backHref.onClick}>
              {backHref.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="w-full px-4 py-6 md:px-8 md:py-10">
        <QueryState
          query={query}
          errorTitle={t("Could not load the plan", "Kunne ikke hente planen")}
        >
          {({ plan, comments, approvals }) => {
            const overall = overallProgress(plan.sections);
            const planComments = comments.filter(
              (comment) => comment.section_id === null && comment.task_id === null,
            );
            const awaiting = questionsAwaitingClient(plan.sections);
            const taskEntry = activeTaskId
              ? plan.sections
                  .flatMap((section, index) =>
                    section.tasks.map((task) => ({ task, section, index })),
                  )
                  .find((entry) => entry.task.id === activeTaskId)
              : undefined;

            return (
              <div className="space-y-8">
                <header className="max-w-3xl space-y-4">
                  {!preview ? (
                    <Link
                      to="/app/planner"
                      className="text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      {t("← Plans", "← Planer")}
                    </Link>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-display text-[34px] font-normal leading-[1.1] tracking-[-0.01em] max-md:text-[28px]">
                      {plan.title}
                    </h1>
                    <StatusPill tone={plan.status === "completed" ? "success" : "info"}>
                      {t(
                        plan.status.charAt(0).toUpperCase() + plan.status.slice(1),
                        planStatusDa(plan.status),
                      )}
                    </StatusPill>
                  </div>
                  <div className="space-y-2 rounded-2xl border bg-card p-4 md:p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-display text-[32px] leading-none">
                        {overall.percent}%
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {overall.total === 0
                          ? t("The plan is being prepared", "Planen er under udarbejdelse")
                          : t(
                              `${overall.done} of ${overall.total} tasks completed`,
                              `${overall.done} af ${overall.total} opgaver færdige`,
                            )}
                      </span>
                    </div>
                    <ProgressBar
                      value={overall.percent}
                      label={t("Overall progress", "Samlet fremdrift")}
                    />
                  </div>
                  {awaiting.length > 0 ? (
                    <div
                      role="status"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <HelpCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                        <span>
                          <strong className="font-medium">
                            {awaiting.length}{" "}
                            {t(
                              awaiting.length === 1
                                ? "question needs your answer."
                                : "questions need your answer.",
                              "spørgsmål venter på dit svar.",
                            )}
                          </strong>{" "}
                          {t("Your answer helps us move forward.", "Det hjælper os videre.")}
                        </span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openTask(awaiting[0].task.id)}
                        className="max-md:w-full"
                      >
                        {t("Answer now", "Besvar nu")}
                      </Button>
                    </div>
                  ) : null}
                </header>

                {plan.sections.length === 0 ? (
                  <Card className="max-w-3xl p-6 text-center text-sm text-muted-foreground">
                    {t(
                      "Plan sections will appear here when ready.",
                      "Planen er endnu ikke delt op i afsnit. Kig tilbage snart.",
                    )}
                  </Card>
                ) : (
                  <ol
                    aria-label={t("Plan sections", "Planens afsnit")}
                    className="-mx-4 flex snap-x snap-proximity items-start gap-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8"
                  >
                    {plan.sections.map((section, index) => (
                      <SectionColumn
                        key={section.id}
                        planId={plan.id}
                        section={section}
                        index={index}
                        comments={comments.filter(
                          (comment) => comment.section_id === section.id && !comment.task_id,
                        )}
                        taskComments={comments.filter((comment) => comment.task_id)}
                        approvals={approvals.filter(
                          (approval) => approval.section_id === section.id,
                        )}
                        preview={preview}
                        onOpenTask={openTask}
                      />
                    ))}
                  </ol>
                )}

                <section aria-labelledby="plan-comments" className="max-w-3xl space-y-3">
                  <h2 id="plan-comments" className="font-display text-2xl">
                    {t("Plan comments", "Kommentarer til hele planen")}
                  </h2>
                  <CommentThread planId={plan.id} sectionId={null} comments={planComments} />
                </section>

                <TaskDialog
                  planId={plan.id}
                  entry={taskEntry}
                  open={Boolean(taskEntry)}
                  onClose={() => openTask(null)}
                  comments={comments.filter((comment) => comment.task_id === activeTaskId)}
                />
              </div>
            );
          }}
        </QueryState>
      </div>
    </div>
  );
}

function SectionColumn({
  planId,
  section,
  index,
  comments,
  taskComments,
  approvals,
  preview,
  onOpenTask,
}: {
  planId: string;
  section: ClientSection;
  index: number;
  comments: ClientComment[];
  taskComments: ClientComment[];
  approvals: ClientApproval[];
  preview: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const t = usePortalText();
  const { user } = useAuth();
  const [open, setOpen] = useState(comments.length > 0);
  const [editing, setEditing] = useState(false);
  const color = sectionColor(section.color, index);
  const percent = sectionPercent(section);
  const status = sectionStatusDa(section);
  const approvedByMe = approvals.some((approval) => approval.user_id === user?.id);
  const awaiting = questionsAwaitingClient([section]).length;

  const approve = useServerAction(useServerFn(setSectionApproval), {
    label: "clientPlan.approve",
    invalidate: [qk.plan(planId)],
  });

  return (
    <li className="w-[min(88vw,340px)] shrink-0 snap-start">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ backgroundColor: color }} aria-hidden="true" />
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="font-display text-lg text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {awaiting > 0 ? (
                  <StatusPill tone="warning">
                    {awaiting}{" "}
                    {t(
                      awaiting === 1 ? "question for you" : "questions for you",
                      "spørgsmål til dig",
                    )}
                  </StatusPill>
                ) : null}
                <StatusPill
                  tone={status === "Færdig" ? "success" : status === "I gang" ? "info" : "default"}
                >
                  {t(
                    status === "Færdig"
                      ? "Done"
                      : status === "I gang"
                        ? "In progress"
                        : "Not started",
                    status,
                  )}
                </StatusPill>
              </span>
            </div>
            <h2 className="break-words font-display text-[22px] leading-tight">{section.title}</h2>
          </div>

          {editing ? (
            <SummaryEditor planId={planId} section={section} onDone={() => setEditing(false)} />
          ) : (
            <div>
              {section.client_summary ? (
                <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                  {section.client_summary}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  {preview
                    ? t(
                        "Add a short summary for your client.",
                        "Ingen opsummering endnu. Skriv en kort, letforståelig tekst til kunden.",
                      )
                    : t(
                        "A section summary will be available soon.",
                        "Beskrivelsen af dette afsnit følger snart.",
                      )}
                </p>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                {section.client_summary
                  ? t("Edit summary", "Ret teksten")
                  : t("Write a summary", "Skriv en tekst")}
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <ProgressBar
              value={percent}
              label={section.title + " · " + t("Progress", "Fremdrift")}
            />
            <p className="text-xs text-muted-foreground">
              {section.task_count === 0
                ? t("No tasks yet", "Ingen opgaver endnu")
                : t(
                    `${section.done_task_count} of ${section.task_count} tasks completed · ${percent}%`,
                    `${section.done_task_count} af ${section.task_count} opgaver færdige · ${percent}%`,
                  )}
            </p>
          </div>

          {section.tasks.length > 0 ? (
            <ul className="space-y-2" aria-label={t("Tasks in ", "Opgaver i ") + section.title}>
              {section.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  commentCount={taskComments.filter((c) => c.task_id === task.id).length}
                  onOpen={() => onOpenTask(task.id)}
                />
              ))}
            </ul>
          ) : section.task_count > 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              {t(
                "Tasks will appear here when ready.",
                "Opgaverne i dette afsnit bliver beskrevet her, så snart de er klar.",
              )}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant={approvedByMe ? "secondary" : "outline"}
              disabled={approve.busy}
              aria-pressed={approvedByMe}
              onClick={() =>
                approve.fire({ planId, sectionId: section.id, approved: !approvedByMe })
              }
              className="max-md:min-h-10"
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {approvedByMe ? t("Approved by you", "Godkendt af dig") : t("Approve", "Godkend")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="max-md:min-h-10"
            >
              <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {comments.length === 0
                ? t("Comment", "Kommentar")
                : comments.length +
                  " " +
                  t(
                    comments.length === 1 ? "comment" : "comments",
                    comments.length === 1 ? "kommentar" : "kommentarer",
                  )}
            </Button>
            {approvals.length > 0 ? (
              <span className="w-full text-xs text-muted-foreground">
                {t("Approved by", "Godkendt af")}{" "}
                {approvals
                  .map((approval) => personName(approval.user, t("a user", "en bruger")))
                  .join(", ")}
              </span>
            ) : null}
          </div>

          {open ? (
            <CommentThread planId={planId} sectionId={section.id} comments={comments} />
          ) : null}
        </div>
      </Card>
    </li>
  );
}

/** One task in plain words. A click opens everything about it. */
function TaskCard({
  task,
  commentCount,
  onOpen,
}: {
  task: ClientTask;
  commentCount: number;
  onOpen: () => void;
}) {
  const t = usePortalText();
  const awaiting = task.questions.filter((question) => question.awaiting_client).length;
  const doneSteps = task.steps.filter((step) => step.done).length;
  const metFeatures = task.features.filter((feature) => feature.met).length;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "w-full space-y-1.5 rounded-xl border bg-card p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11",
          awaiting > 0 && "border-warning/60",
        )}
      >
        <span
          className={cn(
            "block break-words text-sm font-medium leading-snug",
            task.status === "done" && "text-muted-foreground line-through decoration-1",
          )}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={TASK_TONE[task.status]}>
            {t(
              { todo: "Not started", in_progress: "In progress", waiting: "Waiting", done: "Done" }[
                task.status
              ],
              CLIENT_TASK_STATUS_DA[task.status],
            )}
          </StatusPill>
          {awaiting > 0 ? (
            <StatusPill tone="warning">
              {awaiting}{" "}
              {t(awaiting === 1 ? "question for you" : "questions for you", "spørgsmål til dig")}
            </StatusPill>
          ) : null}
          {task.features.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {metFeatures} {t("of", "af")} {task.features.length} {t("delivered", "leveret")}
            </span>
          ) : task.steps.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {doneSteps} {t("of", "af")} {task.steps.length}
            </span>
          ) : null}
          {commentCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              {commentCount}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** Everything about one task: what it must deliver, its steps, questions and comments. */
function TaskDialog({
  planId,
  entry,
  open,
  onClose,
  comments,
}: {
  planId: string;
  entry: { task: ClientTask; section: ClientSection; index: number } | undefined;
  open: boolean;
  onClose: () => void;
  comments: ClientComment[];
}) {
  const t = usePortalText();
  const task = entry?.task;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-[620px] max-md:max-h-[100dvh] max-md:w-full max-md:rounded-none overflow-y-auto">
        {task && entry ? (
          <div className="space-y-6">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: sectionColor(entry.section.color, entry.index) }}
                />
                {entry.section.title}
              </div>
              <DialogTitle className="font-display text-[26px] font-normal leading-tight">
                {task.title}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={TASK_TONE[task.status]}>
                    {t(
                      {
                        todo: "Not started",
                        in_progress: "In progress",
                        waiting: "Waiting",
                        done: "Done",
                      }[task.status],
                      CLIENT_TASK_STATUS_DA[task.status],
                    )}
                  </StatusPill>
                </div>
              </DialogDescription>
            </DialogHeader>

            {task.summary ? (
              <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">
                {task.summary}
              </p>
            ) : null}

            {task.features.length > 0 ? (
              <section aria-labelledby={`f-${task.id}`} className="space-y-2">
                <h3 id={`f-${task.id}`} className="font-display text-xl">
                  {t("Deliverables", "Det skal leveres")}{" "}
                  <span className="text-sm font-sans text-muted-foreground">
                    {task.features.filter((f) => f.met).length} {t("of", "af")}{" "}
                    {task.features.length}
                  </span>
                </h3>
                <ul className="space-y-1.5">
                  {task.features.map((feature) => (
                    <li key={feature.id} className="flex items-start gap-2 text-sm">
                      {feature.met ? (
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={cn(
                          "min-w-0 break-words",
                          feature.met && "text-muted-foreground",
                        )}
                      >
                        <span className="sr-only">
                          {feature.met
                            ? t("Delivered: ", "Leveret: ")
                            : t("Pending: ", "Mangler: ")}
                        </span>
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {task.steps.length > 0 ? (
              <section aria-labelledby={`s-${task.id}`} className="space-y-2">
                <h3 id={`s-${task.id}`} className="font-display text-xl">
                  {t("Steps", "Trin")}
                </h3>
                <ul className="space-y-1.5">
                  {task.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2 text-sm">
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          step.done
                            ? "border-success bg-success/15 text-success"
                            : "border-muted-foreground/40",
                        )}
                        aria-hidden="true"
                      >
                        {step.done ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span
                        className={cn("min-w-0 break-words", step.done && "text-muted-foreground")}
                      >
                        <span className="sr-only">
                          {step.done ? t("Done: ", "Færdig: ") : t("Pending: ", "Mangler: ")}
                        </span>
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <TaskQuestions planId={planId} task={task} />

            <section aria-labelledby={`c-${task.id}`} className="space-y-2">
              <h3 id={`c-${task.id}`} className="font-display text-xl">
                {t("Comments", "Kommentarer")}
              </h3>
              <CommentThread
                planId={planId}
                sectionId={null}
                taskId={task.id}
                comments={comments}
                bordered={false}
              />
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Questions on a task: the ones waiting for the client first, then the rest, then a way to ask. */
function TaskQuestions({ planId, task }: { planId: string; task: ClientTask }) {
  const t = usePortalText();
  const waiting = task.questions.filter((question) => question.awaiting_client);
  const rest = task.questions.filter((question) => !question.awaiting_client);

  return (
    <section aria-labelledby={`q-${task.id}`} className="space-y-3">
      <h3 id={`q-${task.id}`} className="font-display text-xl">
        {t("Questions", "Spørgsmål")}
      </h3>

      {waiting.map((question) => (
        <AnswerCard key={question.id} planId={planId} question={question} />
      ))}

      {rest.length > 0 ? (
        <ul className="space-y-2">
          {rest.map((question) => (
            <li
              ref={scrollToFragment}
              id={"question-" + question.id}
              key={question.id}
              className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm"
            >
              <p className="whitespace-pre-line break-words font-medium">{question.body}</p>
              <p className="text-xs text-muted-foreground">
                {question.from_client
                  ? t("Your question to us", "Dit spørgsmål til os")
                  : t("Question for you", "Spørgsmål til dig")}{" "}
                ·{" "}
                {question.status === "answered"
                  ? t(
                      "answered " + formatRelative(question.answered_at!),
                      `besvaret ${formatRelativeDa(question.answered_at)}`,
                    )
                  : t("awaiting a reply", "venter på svar")}
              </p>
              {question.answer ? (
                <p className="whitespace-pre-line break-words rounded-md bg-card px-2.5 py-2">
                  <span className="mb-0.5 block text-xs text-muted-foreground">
                    {question.from_client
                      ? t("Our answer", "Vores svar")
                      : t("Your answer", "Dit svar")}
                  </span>
                  {question.answer}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {waiting.length === 0 && rest.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("No questions yet.", "Der er ingen spørgsmål endnu.")}
        </p>
      ) : null}

      <AskForm planId={planId} taskId={task.id} />
    </section>
  );
}

function AnswerCard({ planId, question }: { planId: string; question: ClientQuestion }) {
  const t = usePortalText();
  const [answer, setAnswer] = useState("");
  const send = useServerAction(useServerFn(answerClientQuestion), {
    label: "clientPlan.answerQuestion",
    success: t("Thank you for your answer", "Tak for dit svar"),
    invalidate: [qk.plan(planId)],
    onSuccess: () => setAnswer(""),
  });
  const submit = () => {
    if (!answer.trim() || send.busy) return;
    send.fire({ questionId: question.id, answer });
  };

  return (
    <div
      ref={scrollToFragment}
      id={"question-" + question.id}
      className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-3"
    >
      <p className="flex items-start gap-2 text-sm font-medium">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="whitespace-pre-line break-words">{question.body}</span>
      </p>
      <Textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        rows={3}
        maxLength={5000}
        aria-label={t("Your answer: ", "Dit svar: ") + question.body}
        placeholder={t("Write your answer here…", "Skriv dit svar her…")}
        className="resize-y bg-background text-sm"
      />
      <Button type="button" size="sm" disabled={send.busy || !answer.trim()} onClick={submit}>
        {send.busy ? t("Sending…", "Sender…") : t("Send answer", "Send svar")}
      </Button>
    </div>
  );
}

function AskForm({ planId, taskId }: { planId: string; taskId: string }) {
  const t = usePortalText();
  const [body, setBody] = useState("");
  const ask = useServerAction(useServerFn(askClientQuestion), {
    label: "clientPlan.askQuestion",
    success: t("Question sent", "Dit spørgsmål er sendt"),
    invalidate: [qk.plan(planId)],
    onSuccess: () => setBody(""),
  });
  const submit = () => {
    if (!body.trim() || ask.busy) return;
    ask.fire({ taskId, body });
  };

  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={2000}
        aria-label={t("Ask us a question", "Stil et spørgsmål til os")}
        placeholder={t(
          "What would you like to ask us?",
          "Er der noget, du er i tvivl om? Stil et spørgsmål til os…",
        )}
        className="resize-y text-sm"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={ask.busy || !body.trim()}
        onClick={submit}
      >
        {ask.busy ? t("Sending…", "Sender…") : t("Ask question", "Stil spørgsmål")}
      </Button>
    </div>
  );
}

function SummaryEditor({
  planId,
  section,
  onDone,
}: {
  planId: string;
  section: ClientSection;
  onDone: () => void;
}) {
  const t = usePortalText();
  const [text, setText] = useState(section.client_summary ?? "");
  const save = useServerAction(useServerFn(setSectionClientSummary), {
    label: "clientPlan.setSummary",
    success: t("Summary saved", "Teksten er gemt"),
    invalidate: [qk.plan(planId)],
    onSuccess: onDone,
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.fire({ sectionId: section.id, summary: text });
      }}
    >
      <Textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        maxLength={CLIENT_SUMMARY_MAX}
        aria-label={t("Summary for ", "Tekst til ") + section.title}
        placeholder={t(
          "Briefly describe the current progress.",
          "Kort og letforståeligt: hvad sker der her, og hvor er vi?",
        )}
        className="resize-y text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.busy}>
          {save.busy ? t("Saving…", "Gemmer…") : t("Save", "Gem")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={save.busy} onClick={onDone}>
          {t("Cancel", "Annuller")}
        </Button>
      </div>
    </form>
  );
}

/** Comments on a section, a task, or (neither) the whole plan. Also used on the agency's task. */
export function CommentThread({
  planId,
  sectionId,
  taskId = null,
  comments,
  bordered = true,
}: {
  planId: string;
  sectionId: string | null;
  taskId?: string | null;
  comments: ClientComment[];
  bordered?: boolean;
}) {
  const t = usePortalText();
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const add = useServerAction(useServerFn(addPlanComment), {
    label: "clientPlan.comment",
    invalidate: [qk.plan(planId)],
    onSuccess: () => setBody(""),
  });
  const remove = useServerAction(useServerFn(deletePlanComment), {
    label: "clientPlan.deleteComment",
    invalidate: [qk.plan(planId)],
  });

  const send = () => {
    if (!body.trim() || add.busy) return;
    add.fire({ planId, sectionId, taskId, body });
  };

  return (
    <div className={cn("space-y-3", bordered && "border-t pt-4")}>
      {comments.length > 0 ? (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <PersonAvatar person={comment.author} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">
                    {personName(comment.author, t("Agency", "Bureauet"))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(formatRelative(comment.created_at), formatRelativeDa(comment.created_at))}
                  </span>
                  {comment.author?.id === user?.id ? (
                    <button
                      type="button"
                      disabled={remove.busy}
                      onClick={() => remove.fire({ commentId: comment.id })}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline max-md:min-h-9"
                    >
                      {t("Delete", "Slet")}
                    </button>
                  ) : null}
                </div>
                <p className="whitespace-pre-line break-words text-sm">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("No comments yet.", "Ingen kommentarer endnu.")}
        </p>
      )}
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={CLIENT_COMMENT_MAX}
          aria-label={
            taskId
              ? t("Comment on the task", "Skriv en kommentar til opgaven")
              : sectionId
                ? t("Comment on the section", "Skriv en kommentar til afsnittet")
                : t("Comment on the plan", "Skriv en kommentar til planen")
          }
          placeholder={t("Write a comment or question…", "Skriv en kommentar eller et spørgsmål…")}
          className="resize-y text-sm"
        />
        <Button type="button" size="sm" disabled={add.busy || !body.trim()} onClick={send}>
          {add.busy ? t("Sending…", "Sender…") : "Send"}
        </Button>
      </div>
    </div>
  );
}
