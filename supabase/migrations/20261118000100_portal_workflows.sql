-- Search only the vocabulary the caller can see on the corresponding board.
create function public.planner_lookup(_workspace uuid, _term text, _waiting boolean default false)
returns table(kind text, item_id uuid, plan_id uuid, task_id uuid, project text, title text)
language sql stable security definer set search_path = public as $$
  with visible as (
    select p.id, p.title, pr.title as project, public.is_workspace_admin(p.workspace_id, auth.uid()) as agency
    from plans p left join projects pr on pr.id = p.project_id
    where p.workspace_id = _workspace and public.can_view_plan(p.id, auth.uid())
      and (not _waiting or public.can_edit_plan(p.id, auth.uid()))
  ), items as (
    select 'Plan' as kind, v.id as item_id, v.id as plan_id, null::uuid as task_id, v.project, v.title
    from visible v where not _waiting
    union all
    select 'Task', t.id, v.id, t.id, v.project, case when v.agency then t.title else t.client_title end
    from visible v join plan_tasks t on t.plan_id = v.id where not _waiting
    union all
    select 'Question', q.id, v.id, t.id, v.project,
      case when v.agency or q.from_client then q.body else q.client_body end
    from visible v join plan_tasks t on t.plan_id = v.id join plan_task_questions q on q.task_id = t.id
    where (v.agency or (nullif(trim(t.client_title),'') is not null and q.status <> 'dismissed'
      and (q.from_client or (q.audience = 'client' and nullif(trim(q.client_body),'') is not null))))
      and (not _waiting or (q.audience = 'client' and q.status = 'open'))
  )
  select * from items where nullif(trim(title),'') is not null
    and (_waiting or (length(trim(_term)) >= 2 and strpos(lower(title), lower(trim(_term))) > 0))
  order by title, item_id limit case when _waiting then null else 20 end;
$$;
revoke all on function public.planner_lookup(uuid,text,boolean) from public,anon;
grant execute on function public.planner_lookup(uuid,text,boolean) to authenticated;

-- The entries, invoice header and lines commit together. A competing invoice or a
-- changed duration/rate invalidates the preview and rolls the whole operation back.
create function public.issue_invoice(_input jsonb)
returns table(id uuid, number text)
language plpgsql security invoker set search_path = public as $$
declare
  proj projects%rowtype;
  inv invoices%rowtype;
  entry_ids uuid[] := array(select jsonb_array_elements_text(_input->'timeEntryIds')::uuid);
  items jsonb := _input->'lines';
  minutes integer;
  billed integer;
  charge bigint;
  subtotal bigint;
  tax integer := (_input->>'taxBps')::integer;
begin
  select * into strict proj from projects where projects.id = (_input->>'projectId')::uuid for share;
  if not is_workspace_admin(proj.workspace_id,auth.uid()) then raise exception 'Forbidden'; end if;
  if cardinality(entry_ids) > 0 then
    perform 1 from time_entries where time_entries.id = any(entry_ids) order by time_entries.id for update;
    select count(*),sum(duration_minutes) into billed,minutes from time_entries
      where time_entries.id = any(entry_ids) and project_id = proj.id and billable and ended_at is not null and invoice_id is null;
    if billed <> cardinality(entry_ids) then raise exception 'Selected time is no longer available'; end if;
    if _input ? 'timeChargeCents' then
      charge := round(minutes::numeric * proj.hourly_rate_cents / 60);
      if charge is null or charge is distinct from (_input->>'timeChargeCents')::bigint
        or minutes is distinct from (_input->>'timeMinutes')::int or proj.currency <> _input->>'currency'
      then raise exception 'Time or rate changed. Refresh the invoice preview.'; end if;
      items := items || jsonb_build_array(jsonb_build_object('description',minutes || ' minutes at project hourly rate',
        'quantity',1,'unit_price_cents',charge));
    end if;
  end if;
  if jsonb_array_length(items) < 1 then raise exception 'An invoice needs a line item'; end if;
  select sum(round(x.quantity*x.unit_price_cents)) into subtotal from jsonb_to_recordset(items) x(quantity numeric,unit_price_cents bigint);
  insert into invoices(project_id,milestone_id,quote_id,amount_cents,subtotal_cents,tax_bps,currency,due_date,notes,number,status,issued_at)
  values(proj.id,(_input->>'milestoneId')::uuid,(_input->>'quoteId')::uuid,subtotal+round(subtotal*tax/10000.0),subtotal,tax,
    _input->>'currency',(_input->>'dueDate')::date,_input->>'notes',_input->>'number',
    case when (_input->>'send')::boolean then 'sent'::invoice_status else 'draft'::invoice_status end,
    case when (_input->>'send')::boolean then now() end) returning * into inv;
  insert into invoice_line_items(invoice_id,description,unit_price_cents,quantity,position)
    select inv.id,x->>'description',(x->>'unit_price_cents')::bigint,(x->>'quantity')::numeric,ord-1
    from jsonb_array_elements(items) with ordinality as lines(x,ord);
  update time_entries set invoice_id=inv.id where time_entries.id=any(entry_ids);
  return query select inv.id,inv.number::text;
end $$;
revoke all on function public.issue_invoice(jsonb) from public,anon;
grant execute on function public.issue_invoice(jsonb) to authenticated;

-- Count a ticket once per reporting window, on its latest transition to Done
-- in that window. Reopening it later preserves the earlier delivery history.
create function public.project_change_period(_project uuid,_from timestamptz,_to timestamptz,_completed boolean)
returns jsonb language sql stable security invoker set search_path = public as $$
  with completions as (
    select t.id, max(e.created_at) as delivered
    from tickets t join ticket_events e on e.ticket_id=t.id
    where t.project_id=_project and e.kind='status_changed' and e.new_value='done'
      and e.created_at >= _from and e.created_at < _to group by t.id
  ), dated as (
    select t.id,t.title,t.type,t.follow_up_kind,
      case when _completed then 'done' else t.status::text end as status,
      case when not _completed then t.updated_at else coalesce(c.delivered,
        case when t.status='done' and not exists(select 1 from ticket_events e where e.ticket_id=t.id
          and e.kind='status_changed' and e.new_value='done') then t.resolved_at end) end as updated_at
    from tickets t left join completions c on c.id=t.id where t.project_id=_project
  ), period as (select * from dated where updated_at >= _from and updated_at < _to)
  select jsonb_build_object(
    'tickets',coalesce((select jsonb_agg(to_jsonb(p)) from period p),'[]'),
    'linkedTasks',coalesce((select jsonb_agg(jsonb_build_object('ticket_id',t.ticket_id,'plan_id',t.plan_id,'id',t.id))
      from plan_tasks t join period p on p.id=t.ticket_id),'[]'),
    'standaloneTasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'plan_id',t.plan_id,'completed_at',t.completed_at,'status',t.status))
      from plan_tasks t join plans p on p.id=t.plan_id where p.project_id=_project and t.ticket_id is null
      and t.status='done' and t.completed_at >= _from and t.completed_at < _to),'[]')
  );
$$;
revoke all on function public.project_change_period(uuid,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.project_change_period(uuid,timestamptz,timestamptz,boolean) to authenticated;

alter table public.profiles add column portal_language text not null default 'en' check(portal_language in ('en','da'));
