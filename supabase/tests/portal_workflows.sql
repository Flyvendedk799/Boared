-- Exercises real RLS, atomic billing and historical reporting in a disposable transaction.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','portal-admin@example.test'),
 ('10000000-0000-4000-8000-000000000002','portal-client@example.test');
insert into public.workspaces(id,slug,name) values ('20000000-0000-4000-8000-000000000001','workflow-test','Workflow');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','client');
insert into public.user_roles(user_id,workspace_id,role) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','admin') on conflict do nothing;
insert into public.projects(id,workspace_id,title,hourly_rate_cents) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Store',12000);
insert into public.project_members(project_id,user_id) values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into public.plans(id,workspace_id,project_id,title,clients_can_view) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Published',true);
insert into public.plan_sections(id,plan_id,title) values ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Section');
insert into public.plan_tasks(id,plan_id,section_id,title,client_title) values
 ('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Internal wording','Public task');
insert into public.plan_task_questions(task_id,body,client_body,audience) values
 ('60000000-0000-4000-8000-000000000001','Internal question','Public question','client');
insert into public.time_entries(id,project_id,user_id,started_at,ended_at,billable) values
 ('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()-interval '30 minutes',now(),true);
insert into public.tickets(id,project_id,title,reporter_id) values('80000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Checkout','10000000-0000-4000-8000-000000000002');
update public.tickets set status='done' where id='80000000-0000-4000-8000-000000000001';
update public.ticket_events set created_at='2020-01-15' where ticket_id='80000000-0000-4000-8000-000000000001' and new_value='done';
update public.tickets set status='open' where id='80000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
do $$ begin
  if exists(select 1 from planner_lookup('20000000-0000-4000-8000-000000000001','internal')) or
    (select count(*) from planner_lookup('20000000-0000-4000-8000-000000000001','public')) <> 2 or
    (select count(*) from planner_lookup('20000000-0000-4000-8000-000000000001','',true)) <> 1 then
    raise exception 'Unexpected client search or pending decisions'; end if;
end $$;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
do $$
declare
 payload jsonb := '{"projectId":"30000000-0000-4000-8000-000000000001","currency":"USD","send":true,"taxBps":0,"lines":[],"timeEntryIds":["70000000-0000-4000-8000-000000000001"],"timeChargeCents":6000,"timeMinutes":30}';
 inv uuid;
begin
 if jsonb_array_length(project_change_period((payload->>'projectId')::uuid,'2020-01-01','2020-02-01',true)->'tickets') <> 1 then raise exception 'Lost historical delivery after reopen'; end if;
 select id into strict inv from issue_invoice(payload);
 if (select amount_cents from invoices where id=inv) <> 6000 or
    (select count(*) from invoice_line_items where invoice_id=inv) <> 1 then raise exception 'Incorrect invoice'; end if;
 begin
   perform issue_invoice(payload);
   raise exception 'Entry billed twice';
 exception when raise_exception then
   if sqlerrm <> 'Selected time is no longer available' then raise; end if;
 end;
 if (select count(*) from invoices where project_id=(payload->>'projectId')::uuid) <> 1 then raise exception 'Partial invoice'; end if;
end $$;
rollback;
