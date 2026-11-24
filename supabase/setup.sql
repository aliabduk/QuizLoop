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
create table if not exists recall.approved_users(user_id uuid primary key references auth.users on delete cascade);
create or replace function public.recall_access() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from recall.admins where user_id=auth.uid()) or exists(select from recall.approved_users where user_id=auth.uid())
$$;
create or replace function recall.require_access() returns void language plpgsql stable set search_path='' as $$
begin
 if not public.recall_access() then raise exception 'Administrator approval required' using errcode='42501'; end if;
end $$;
create index if not exists recall_question_chapter on recall.questions(chapter,id);
create index if not exists recall_question_deck on recall.questions(deck,id);
create index if not exists recall_user_schedule on recall.progress(user_id,stage,due,question);
create index if not exists recall_user_due on recall.progress(user_id,due,question);
create or replace function public.recall_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform recall.require_access();
 return jsonb_build_object('chapterQuestions',true,'admin',exists(select from recall.admins where user_id=auth.uid()),
 'subjects',coalesce((select jsonb_agg(s order by name) from recall.subjects s),'[]'),
 'chapters',coalesce((select jsonb_agg(c order by name) from recall.chapters c),'[]'),
 'decks',coalesce((select jsonb_agg(d order by name) from recall.decks d),'[]'),
 'groups',coalesce((select jsonb_agg(g) from (
 select c.subject,q.chapter,q.deck,count(*) total,count(p.question) seen,count(*) filter(where p.stage=0) missed,
 count(*) filter(where p.stage>=3) learned,count(*) filter(where p.due is null or p.due<=now()) ready
 from recall.questions q join recall.chapters c on c.id=q.chapter
 left join recall.progress p on p.question=q.id and p.user_id=auth.uid() group by c.subject,q.chapter,q.deck) g),'[]'));
end $$;
create or replace function public.recall_page(scope text,item uuid,page_offset int) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform recall.require_access();
 return coalesce((select jsonb_agg(r order by id) from (
 select q.id,q.prompt,q.deck,p.stage,p.due from recall.questions q left join recall.progress p on p.question=q.id and p.user_id=auth.uid()
 where (scope='chapter' and q.chapter=item) or (scope='deck' and q.deck=item) order by q.id limit 40 offset greatest(0,page_offset)) r),'[]');
end $$;
create or replace function public.recall_next(scope text,item uuid,day_start timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare slot int; preferred text; bucket text; candidate uuid; result jsonb;
begin
 perform recall.require_access();
 select (count(*) % 10)::int+1 into slot from recall.attempts where user_id=auth.uid() and at>=day_start;
 preferred:=(array['new','wrong','new','correct','new','wrong','new','new','wrong','new'])[slot];
 -- Usually the preferred bucket provides the card on the first lookup.
 for bucket in select unnest(array[preferred,'review','new']) loop
  if bucket='new' then
   select q.id into candidate from recall.questions q join recall.chapters c on c.id=q.chapter
   where (scope='all' or (scope='subject' and c.subject=item) or (scope='chapter' and q.chapter=item)
    or (scope='deck' and q.deck=item) or (scope='question' and q.id=item))
    and not exists(select from recall.progress p where p.user_id=auth.uid() and p.question=q.id)
   order by q.id limit 1;
  else
   select p.question into candidate from recall.progress p join recall.questions q on q.id=p.question
   join recall.chapters c on c.id=q.chapter
   where p.user_id=auth.uid() and p.due<=now() and
    (bucket='review' or (bucket='wrong' and p.stage=0) or (bucket='correct' and p.stage>0))
    and (scope='all' or (scope='subject' and c.subject=item) or (scope='chapter' and q.chapter=item)
    or (scope='deck' and q.deck=item) or (scope='question' and q.id=item))
   order by p.due,p.question limit 1;
  end if;
  exit when candidate is not null;
 end loop;
 select jsonb_build_object('id',q.id,'prompt',q.prompt,'choices',q.choices,'deck',q.deck,'chapter',q.chapter)
 into result from recall.questions q where q.id=candidate;
 return result;
end $$;
create or replace function public.recall_card(qid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform recall.require_access();
 return (select jsonb_build_object('id',id,'prompt',prompt,'choices',choices) from recall.questions where id=qid);
end $$;
create or replace function public.recall_answer(qid uuid,picked text,attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); q recall.questions; p recall.progress; prior recall.attempts; s int; next_due timestamptz;
begin
 perform recall.require_access();
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into strict q from recall.questions where id=qid for share;
 if not q.choices ? picked then raise exception 'Unknown option'; end if;
 select * into prior from recall.attempts where user_id=u and token=attempt;
 if found then
  if prior.question<>qid or prior.choice<>picked then raise exception 'Attempt mismatch'; end if;
 else
  select * into p from recall.progress where user_id=u and question=qid;
  if p.due>now() then raise exception 'Already reviewed on another device. End this session and restart practice.'; end if;
  s:=case when picked=q.answer then least(coalesce(p.stage,0)+1,6) else 0 end;
  next_due:=now()+case when s=0 then interval '10 minutes' else make_interval(days=>(array[1,3,7,14,30,60])[s]) end;
  insert into recall.progress(user_id,question,stage,due) values(u,qid,s,next_due)
   on conflict(user_id,question) do update set stage=excluded.stage,due=excluded.due;
  insert into recall.attempts(user_id,token,question,choice,correct) values(u,attempt,qid,picked,q.answer=picked);
 end if;
 return jsonb_build_object('answer',q.answer,'explanation',q.explanation);
end $$;
create or replace function public.recall_reset(did uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform recall.require_access();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if not exists(select from recall.questions where deck=did) or exists(select from recall.questions q where deck=did
 and not exists(select from recall.progress p where p.user_id=auth.uid() and p.question=q.id)) then raise exception 'Attempt every question before resetting this deck'; end if;
 delete from recall.progress p using recall.questions q where p.question=q.id and q.deck=did and p.user_id=auth.uid();
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
create or replace function public.recall_tools() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare admin boolean:=exists(select from recall.admins where user_id=auth.uid());
begin
 perform recall.require_access();
 return jsonb_build_object('marks',coalesce((select jsonb_agg(jsonb_build_object('id',m.question,'kind',m.kind,'prompt',q.prompt,'chapter',q.chapter))
 from recall.marks m join recall.questions q on q.id=m.question where m.user_id=auth.uid()),'[]'),
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'qid',r.question,'note',r.note,'prompt',q.prompt) order by r.created)
 from recall.reports r join recall.questions q on q.id=r.question where admin and r.resolved is null),'[]'),
 'flags',coalesce((select jsonb_agg(f) from (select q.id,q.prompt,count(*) flags from recall.questions q join recall.marks m on m.question=q.id
 where admin and m.kind='flagged' group by q.id order by count(*) desc,q.id) f),'[]'),
 'pending',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email) order by u.created_at) from auth.users u
 where admin and not exists(select from recall.admins where user_id=u.id) and not exists(select from recall.approved_users where user_id=u.id)),'[]'));
end $$;
create or replace function public.recall_mark(qid uuid,kind text,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
perform recall.require_access();
if enabled then insert into recall.marks values(auth.uid(),qid,kind) on conflict do nothing;
else delete from recall.marks m where m.user_id=auth.uid() and m.question=qid and m.kind=$2; end if;
end $$;
create or replace function public.recall_report(qid uuid,note text) returns void language plpgsql security definer set search_path='' as $$
begin
perform recall.require_access();
if coalesce(length(trim(note)),0) not between 1 and 1000 then raise exception 'Describe the issue in 1–1000 characters'; end if;
insert into recall.reports(user_id,question,note) values(auth.uid(),qid,trim(note))
on conflict(user_id,question) where resolved is null do update set note=excluded.note;
end $$;
create or replace function public.recall_reference(qid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
perform recall.require_access();
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
perform recall.require_access();
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

create or replace function recall.merge_node(kind text,src uuid,dest uuid) returns void language plpgsql set search_path='' as $$
declare child record; matched uuid;
begin
 if src=dest or dest is null then raise exception 'Choose a different destination'; end if;
 if kind='subject' then
  perform id from recall.subjects where id=dest; if not found then raise exception 'Destination missing'; end if;
  for child in select * from recall.chapters where subject=src loop
   select id into matched from recall.chapters where subject=dest and name=child.name;
   if matched is null then update recall.chapters set subject=dest where id=child.id;
   else perform recall.merge_node('chapter',child.id,matched); end if;
  end loop;
  delete from recall.subjects where id=src;
 elsif kind='chapter' then
  perform id from recall.chapters where id=dest; if not found then raise exception 'Destination missing'; end if;
  for child in select * from recall.decks where chapter=src loop
   select id into matched from recall.decks where chapter=dest and name=child.name;
   if matched is null then update recall.decks set chapter=dest where id=child.id;
   else perform recall.merge_node('deck',child.id,matched); end if;
  end loop;
  update recall.questions set chapter=dest where chapter=src;
  delete from recall.chapters where id=src;
 elsif kind='deck' then
  select chapter into strict matched from recall.decks where id=dest;
  update recall.questions set deck=dest,chapter=matched where deck=src;
  delete from recall.decks where id=src;
 end if;
end $$;
create or replace function public.recall_manage(op text,kind text,src uuid,dest uuid default null,label text default null,changes jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare dest_check uuid; relation_name text; ids uuid[]; q recall.questions; opts jsonb;
begin
 if not exists(select from recall.admins where user_id=auth.uid()) then raise exception 'Administrator access required'; end if;
 if op='approve' then
  insert into recall.approved_users values(src) on conflict do nothing; return;
 end if;
 relation_name:=case kind when 'subject' then 'subjects' when 'chapter' then 'chapters' when 'deck' then 'decks' when 'question' then 'questions' end;
 if relation_name is null then raise exception 'Unknown item type'; end if;
 lock table recall.subjects,recall.chapters,recall.decks,recall.questions in share row exclusive mode;
 execute format('select id from recall.%I where id=$1',relation_name) into strict dest_check using src;
 if op='rename' and kind<>'question' and nullif(trim(label),'') is not null then
  execute format('update recall.%I set name=$1 where id=$2',relation_name) using trim(label),src;
 elsif op='merge' and kind<>'question' then
  perform recall.merge_node(kind,src,dest);
 elsif op='edit' and kind='question' then
  select * into strict q from recall.questions where id=src;
  if (changes->>'revision')::int is distinct from q.revision then raise exception 'Question changed. Reopen it before editing.'; end if;
  opts:=changes->'choices';
  if jsonb_typeof(opts) is distinct from 'object' or coalesce(trim(changes->>'prompt'),'')='' or not coalesce(opts ? (changes->>'answer'),false)
   or (select array_agg(k order by k) from jsonb_object_keys(opts) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(q.choices) k)
   or exists(select from jsonb_each_text(opts) where coalesce(trim(value),'')='')
   or (select count(distinct lower(trim(value)))<>count(*) from jsonb_each_text(opts)) then raise exception 'Supply a prompt, distinct choices and a valid correct option'; end if;
  update recall.questions set prompt=trim(changes->>'prompt'),choices=opts,answer=changes->>'answer',explanation=coalesce(changes->>'explanation',''),revision=revision+1 where id=src;
  delete from recall.marks where kind='flagged' and question=src;
 elsif op='delete' then
  select array_agg(b.id) into ids from recall.questions b join recall.chapters c on c.id=b.chapter where case kind
   when 'subject' then c.subject=src when 'chapter' then b.chapter=src when 'deck' then b.deck=src else b.id=src end;
  delete from recall.progress where question=any(ids);
  delete from recall.attempts where question=any(ids);
  delete from recall.questions where id=any(ids);
  if kind in ('chapter','subject') then delete from recall.decks where chapter in
   (select id from recall.chapters where case when kind='chapter' then id=src else subject=src end); end if;
  if kind='subject' then delete from recall.chapters where subject=src; end if;
  if kind<>'question' then execute format('delete from recall.%I where id=$1',relation_name) using src; end if;
 else raise exception 'Invalid operation'; end if;
exception when unique_violation then raise exception 'Duplicate name or question prompt in the destination. Resolve the conflict and retry. No changes were made.';
end $$;
revoke all on function public.recall_access(),public.recall_manage(text,text,uuid,uuid,text,jsonb),public.recall_page(text,uuid,int),public.recall_next(text,uuid,timestamptz),public.recall_reset(uuid) from public,anon;
grant execute on function public.recall_access(),public.recall_manage(text,text,uuid,uuid,text,jsonb),public.recall_page(text,uuid,int),public.recall_next(text,uuid,timestamptz),public.recall_reset(uuid) to authenticated;

commit;
