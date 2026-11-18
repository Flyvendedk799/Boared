import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { deadlineReminderQuery } from "@/data/sla";
import { slaLabel } from "./sla-state";

export function DeadlineReminder({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const tickets = useQuery(deadlineReminderQuery(workspaceId, userId));
  if (!tickets.data?.length) return null;
  return (
    <details className="border-b bg-accent px-4 py-2">
      <summary className="min-h-11 cursor-pointer content-center font-medium">
        {tickets.data.length} ticket deadlines need attention
      </summary>
      <ul className="max-h-52 overflow-auto">
        {tickets.data.map((t) => (
          <li key={t.id}>
            <Link
              className="block min-h-11 py-2 underline"
              to="/app/tickets/$ticketId"
              params={{ ticketId: t.id }}
            >
              #{t.ticket_number} · {t.title} · {slaLabel(t.sla_due_at, t.status)?.text}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
