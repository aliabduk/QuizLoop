begin;
create schema if not exists recall;
revoke all on schema recall from public, anon, authenticated;
create table if not exists recall.admins(user_id uuid primary key references auth.users on delete cascade);
create table if not exists recall.subjects(id uuid primary key default gen_random_uuid(), name text unique not null);
create table if not exists recall.chapters(id uuid primary key default gen_random_uuid(), subject uuid not null references recall.subjects, name text not null, unique(subject,name));
create table if not exists recall.decks(id uuid primary key default gen_random_uuid(), chapter uuid not null references recall.chapters, name text not null, unique(chapter,name));
create table if not exists recall.questions(id uuid primary key default gen_random_uuid(), deck uuid not null references recall.decks, prompt text not null, choices jsonb not null, answer text not null, explanation text not null default '');
alter table recall.questions add column if not exists chapter uuid references recall.chapters;
update recall.questions q set chapter=d.chapter from recall.decks d where q.deck=d.id and q.chapter is null;
alter table recall.questions alter column chapter set not null, alter column deck drop not null;
create unique index if not exists recall_chapter_question on recall.questions(chapter,md5(prompt)) where deck is null;
create unique index if not exists recall_unique_question on recall.questions(deck,md5(prompt));
create table if not exists recall.progress(user_id uuid references auth.users on delete cascade, question uuid references recall.questions, stage integer not null, due timestamptz not null, primary key(user_id,question));
create table if not exists recall.attempts(user_id uuid references auth.users on delete cascade, token uuid, question uuid references recall.questions, choice text not null, correct boolean not null, at timestamptz default now(),primary key(user_id,token));
create index if not exists recall_history on recall.attempts(user_id,at);
create or replace function public.recall_dashboard() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('chapterQuestions',true,'admin',exists(select from recall.admins where user_id=auth.uid()),'subjects',coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from recall.subjects s),'[]'),'chapters',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from recall.chapters c),'[]'),'decks',coalesce((select jsonb_agg(to_jsonb(d) order by d.name) from recall.decks d),'[]'),'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'deck',q.deck,'chapter',q.chapter,'prompt',q.prompt,'stage',coalesce(p.stage,0),'due',p.due) order by p.due nulls last,q.id) from recall.questions q left join recall.progress p on p.question=q.id and p.user_id=auth.uid()),'[]'),'answered', (select count(*) from recall.attempts where user_id=auth.uid()),'correct',(select count(*) from recall.attempts where user_id=auth.uid() and correct)) $$;
create or replace function public.recall_card(qid uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',id,'prompt',prompt,'choices',choices) from recall.questions where id=qid $$;
create or replace function public.recall_answer(qid uuid,picked text,attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); q recall.questions; p recall.progress; prior recall.attempts; ok boolean; s integer; next_due timestamptz;
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
 next_due:=now()+case when s=0 then interval '10 minutes' else make_interval(days=>(array[1,3,7,14,30,60])[s]) end;
 insert into recall.progress values(u,qid,s,next_due) on conflict(user_id,question) do update set stage=excluded.stage,due=excluded.due;
 insert into recall.attempts(user_id,token,question,choice,correct) values(u,attempt,qid,picked,ok);
end if;
return jsonb_build_object('answer',q.answer,'explanation',q.explanation,'due',(select due from recall.progress where user_id=u and question=qid));
end $$;
create or replace function public.recall_import(items jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare r jsonb; sid uuid; cid uuid; did uuid; opts jsonb; keyid text; a jsonb; oid text; added int:=0; countrow int; val text;
begin
if not exists(select from recall.admins where user_id=auth.uid()) then raise exception 'Administrator access required'; end if;
if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>1000 then raise exception 'Use up to 1000 rows per import'; end if;
for r in select value from jsonb_array_elements(items) loop
 if coalesce(trim(r->>'subject'),'')='' then raise exception 'Subject required'; end if;
 insert into recall.subjects(name) values(trim(r->>'subject')) on conflict(name) do update set name=excluded.name returning id into sid;
 if coalesce(trim(r->>'chapter'),'')='' then continue; end if;
 insert into recall.chapters(subject,name) values(sid,trim(r->>'chapter')) on conflict(subject,name) do update set name=excluded.name returning id into cid;
 did:=null;
 if coalesce(trim(r->>'deck'),'')<>'' then
 insert into recall.decks(chapter,name) values(cid,trim(r->>'deck')) on conflict(chapter,name) do update set name=excluded.name returning id into did;
 end if;
 if coalesce(trim(r->>'prompt'),'')='' then continue; end if;
 a:=r->'options';
 if a is null or jsonb_typeof(a)<>'array' or jsonb_array_length(a) not between 2 and 4 then raise exception 'Provide two to four answers'; end if;
 if (select count(distinct lower(trim(value))) from jsonb_array_elements_text(a))<>jsonb_array_length(a) then raise exception 'Options must be distinct'; end if;
 opts:='{}';keyid:=null;
 for val in select value from jsonb_array_elements_text(a) loop
 if coalesce(trim(val),'')='' then raise exception 'Empty option'; end if;
 oid:=gen_random_uuid()::text; keyid:=coalesce(keyid,oid);opts:=opts||jsonb_build_object(oid,trim(val));
 end loop;
 insert into recall.questions(chapter,deck,prompt,choices,answer,explanation) values(cid,did,trim(r->>'prompt'),opts,keyid,coalesce(r->>'explanation','')) on conflict do nothing;
 get diagnostics countrow=row_count; added:=added+countrow;
end loop;
return added;
end $$;
revoke all on function public.recall_dashboard(), public.recall_card(uuid), public.recall_answer(uuid,text,uuid), public.recall_import(jsonb) from public,anon;
grant execute on function public.recall_dashboard(), public.recall_card(uuid), public.recall_answer(uuid,text,uuid), public.recall_import(jsonb) to authenticated;
commit;
