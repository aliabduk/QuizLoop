begin;
create table if not exists recall.marks (
  user_id uuid references auth.users on delete cascade,
  question uuid references recall.questions on delete cascade,
  kind text check(kind in ('saved','flagged')),
  primary key(user_id,question,kind)
);
create table if not exists recall.reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  question uuid not null references recall.questions on delete cascade, note text not null,
  created timestamptz not null default now(), resolved timestamptz
);
create unique index if not exists recall_open_report on recall.reports(user_id,question) where resolved is null;
create index if not exists recall_attempt_history on recall.attempts(user_id,question,at desc);
alter table recall.questions add column if not exists revision int not null default 1;
create table if not exists recall.quizzes (
  user_id uuid primary key references auth.users on delete cascade, id uuid not null, deadline timestamptz not null,
  cards jsonb not null, picks jsonb not null default '{}', finished boolean not null default false
);
create or replace function public.recall_tools() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('marks',coalesce((select jsonb_agg(jsonb_build_object('id',question,'kind',kind)) from recall.marks where user_id=auth.uid()),'[]'),
'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'qid',r.question,'note',r.note) order by r.created) from recall.reports r where resolved is null and exists(select from recall.admins where user_id=auth.uid())),'[]'))
$$;
create or replace function public.recall_mark(qid uuid,kind text,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
if enabled then insert into recall.marks values(auth.uid(),qid,kind) on conflict do nothing;
else delete from recall.marks m where m.user_id=auth.uid() and m.question=qid and m.kind=$2; end if;
end $$;
create or replace function public.recall_report(qid uuid,note text) returns void language plpgsql security definer set search_path='' as $$
begin
if coalesce(length(trim(note)),0) not between 1 and 1000 then raise exception 'Describe the issue in 1–1000 characters'; end if;
insert into recall.reports(user_id,question,note) values(auth.uid(),qid,trim(note))
on conflict(user_id,question) where resolved is null do update set note=excluded.note;
end $$;
create or replace function public.recall_reference(qid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
if not exists(select from recall.marks where user_id=auth.uid() and question=qid)
and not exists(select from recall.admins where user_id=auth.uid()) then raise exception 'Save or flag this question first'; end if;
return (select to_jsonb(q) from recall.questions q where id=qid);
end $$;
create or replace function public.recall_resolve(rid uuid, changes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r recall.reports; q recall.questions; opts jsonb;
begin
if not exists(select from recall.admins where user_id=auth.uid()) then raise exception 'Administrator access required';end if;
select * into strict r from recall.reports where id=rid for update;
if r.resolved is not null then return;end if;
if changes is not null then
 select * into strict q from recall.questions where id=r.question for update;
 if (changes->>'revision')::int is distinct from q.revision then raise exception 'Question changed. Reopen the report.';end if;
 opts:=changes->'choices';
 if jsonb_typeof(opts) is distinct from 'object' or coalesce(trim(changes->>'prompt'),'')='' or not coalesce(opts ? (changes->>'answer'),false) then raise exception 'Invalid question or key'; end if;
 if (select array_agg(k order by k) from jsonb_object_keys(opts) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(q.choices) k)
 or exists(select from jsonb_each_text(opts) where coalesce(trim(value),'')='')
 or (select count(distinct lower(trim(value)))<>count(*) from jsonb_each_text(opts)) then raise exception 'Supply distinct choices for every option';end if;
 update recall.questions set prompt=trim(changes->>'prompt'),choices=opts,answer=changes->>'answer',explanation=coalesce(changes->>'explanation',''),revision=revision+1 where id=q.id;
end if;
update recall.reports set resolved=now() where id=rid;
end $$;
create or replace function public.recall_quiz(op text, run_id uuid default null, subjects uuid[] default null, quantity int default null, minutes int default null, qid text default null, picked text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); quiz recall.quizzes; bank jsonb; card jsonb; t timestamptz;
begin
perform pg_advisory_xact_lock(hashtextextended(u::text,0));t:=clock_timestamp();
select * into quiz from recall.quizzes where user_id=u;
if op='start' and quiz.id is distinct from run_id then
 if quiz.id is not null and quiz.deadline>t and not quiz.finished then raise exception 'Resume the current quiz first';end if;
 if run_id is null or coalesce(quantity,0) not between 1 and 100 or coalesce(minutes,0) not between 1 and 180 or coalesce(cardinality(subjects),0)=0 then raise exception 'Choose subjects, 1–100 questions and 1–180 minutes';end if;
 select jsonb_agg(to_jsonb(z)-'position'-'subject' order by random()) into bank from (
 select q.id,q.prompt,q.choices,q.answer,q.explanation,c.subject,row_number() over(partition by c.subject order by random()) position
 from recall.questions q join recall.chapters c on c.id=q.chapter where c.subject=any(subjects)
 order by position,random() limit quantity) z;
 if coalesce(jsonb_array_length(bank),0)<>quantity then raise exception 'Too few questions in the selected subjects';end if;
 insert into recall.quizzes values(u,run_id,t+make_interval(mins=>minutes),bank,'{}',false)
 on conflict(user_id) do update set id=excluded.id,deadline=excluded.deadline,cards=excluded.cards,picks='{}',finished=false returning * into quiz;
elsif op not in ('state','start','pick','finish') then raise exception 'Unknown quiz action';
end if;
if quiz.id is null then return null;end if;
if op in ('pick','finish') and quiz.id is distinct from run_id then raise exception 'Quiz has changed. Reload.';end if;
if op='pick' and quiz.deadline>t and not quiz.finished then
 select value into strict card from jsonb_array_elements(quiz.cards) where value->>'id'=qid;
 if not coalesce((card->'choices') ? picked,false) then raise exception 'Invalid answer';end if;
 quiz.picks:=quiz.picks||jsonb_build_object(qid,picked);
 update recall.quizzes set picks=quiz.picks where user_id=u;
end if;
if op='finish' or quiz.deadline<=t then
 if not quiz.finished then update recall.quizzes set finished=true where user_id=u;end if;quiz.finished:=true;
end if;
return jsonb_build_object('id',quiz.id,'deadline',quiz.deadline,'now',t,'finished',quiz.finished,'picks',quiz.picks,'cards',
 (select jsonb_agg(case when quiz.finished then value else value-'answer'-'explanation' end order by ord) from jsonb_array_elements(quiz.cards) with ordinality a(value,ord)));
end $$;
revoke all on function public.recall_tools(),public.recall_mark(uuid,text,boolean),public.recall_report(uuid,text),public.recall_reference(uuid),public.recall_resolve(uuid,jsonb),public.recall_quiz(text,uuid,uuid[],int,int,text,text) from public,anon;
grant execute on function public.recall_tools(),public.recall_mark(uuid,text,boolean),public.recall_report(uuid,text),public.recall_reference(uuid),public.recall_resolve(uuid,jsonb),public.recall_quiz(text,uuid,uuid[],int,int,text,text) to authenticated;

create or replace function public.recall_answer(qid uuid,picked text,attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); q recall.questions; p recall.progress; prior recall.attempts; ok boolean; s integer; next_due timestamptz; hits int; misses int; delay_seconds int;
begin
perform pg_advisory_xact_lock(hashtextextended(u::text,0));
select * into strict q from recall.questions where id=qid;
if not q.choices ? picked then raise exception 'Unknown option'; end if;
select * into prior from recall.attempts where user_id=u and token=attempt;
if found then
 if prior.question<>qid or prior.choice<>picked then raise exception 'Attempt mismatch'; end if;
else
 select * into p from recall.progress where user_id=u and question=qid;
 if p.due>now() then raise exception 'Already reviewed. Refresh your queue.'; end if;
 ok:=q.answer=picked;
 s:=case when ok then least(coalesce(p.stage,0)+1,6) else 0 end;
 select count(*) filter(where correct),count(*) filter(where not correct) into hits,misses from (
   select correct from recall.attempts where user_id=u and question=qid order by at desc,token limit 19
 ) recent;
 if ok then
   delay_seconds:=round(86400.0*(array[1,3,7,14,30,60])[s]*(hits+2.0)/(hits+2.0+2*misses));
 else
   delay_seconds:=greatest(60,600/(misses+1));
 end if;
 next_due:=now()+make_interval(secs=>delay_seconds);
 insert into recall.progress values(u,qid,s,next_due) on conflict(user_id,question) do update set stage=excluded.stage,due=excluded.due;
 insert into recall.attempts(user_id,token,question,choice,correct) values(u,attempt,qid,picked,ok);
end if;
return jsonb_build_object('answer',q.answer,'explanation',q.explanation,'due',(select due from recall.progress where user_id=u and question=qid));
end $$;

commit;