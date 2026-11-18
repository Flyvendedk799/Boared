import { qk } from "./keys";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";

export function plannerLookup(
  workspace: string | null | undefined,
  userId: string | undefined,
  term: string,
  waiting = false,
) {
  return queryOptions({
    queryKey: [...qk.plans(), "lookup", workspace, userId, term, waiting],
    enabled: Boolean(workspace && userId && (waiting || term.length >= 2)),
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("planner_lookup", {
        _workspace: workspace!,
        _term: term,
        _waiting: waiting,
      });
      if (error) throw new DataError("planner.lookup", error);
      return data ?? [];
    },
  });
}

export function waitingQuotes(workspace: string | null | undefined, userId: string | undefined) {
  return queryOptions({
    queryKey: [...qk.projects(), "waiting-quotes", workspace, userId],
    enabled: Boolean(workspace && userId),
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id,title,project_id,project:projects(title)")
        .eq("workspace_id", workspace!)
        .eq("status", "sent")
        .order("created_at");
      if (error) throw new DataError("quotes.waiting", error);
      return data ?? [];
    },
  });
}
