-- EDU PLATFORM DATABASE
-- Run this whole file in Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('teacher','student');
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.user_role add value if not exists 'admin';
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.exam_status as enum ('draft','published','closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.attempt_status as enum ('in_progress','submitted','expired');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'User',
  email text,
  role public.user_role not null default 'student',
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique(class_id, student_id)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  description text,
  lesson_order integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  title text not null,
  file_path text not null,
  file_type text not null default 'pdf',
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  duration_minutes integer not null check(duration_minutes > 0),
  status public.exam_status not null default 'draft',
  created_at timestamptz not null default now(),
  check(end_time > start_time)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  text text not null,
  points numeric(10,2) not null default 1 check(points > 0),
  order_no integer not null default 1
);

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  text text not null,
  is_correct boolean not null default false,
  order_no integer not null default 1
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  submitted_at timestamptz,
  score numeric(6,2),
  status public.attempt_status not null default 'in_progress',
  unique(exam_id, student_id)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_option_id uuid references public.question_options(id) on delete set null,
  answered_at timestamptz not null default now(),
  unique(attempt_id, question_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'general',
  exam_id uuid references public.exams(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace view public.leaderboard as
select
  ea.id as attempt_id,
  ea.student_id,
  p.full_name,
  ea.exam_id,
  e.title as exam_title,
  ea.score,
  ea.submitted_at
from public.exam_attempts ea
join public.profiles p on p.id=ea.student_id
join public.exams e on e.id=ea.exam_id
where ea.status in ('submitted','expired') and ea.score is not null;

-- New-user profile trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name','User'),
    new.email
  )
  on conflict(id) do update
  set email=excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Teacher/student helpers
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='teacher') $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;

create or replace function public.is_class_member(p_class_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.class_members where class_id=p_class_id and student_id=auth.uid()) $$;

-- Start an exam on server time.
create or replace function public.start_exam_attempt(p_exam_id uuid, p_student_id uuid)
returns table(attempt_id uuid, ends_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.exams;
  existing public.exam_attempts;
  v_end timestamptz;
begin
  if auth.uid() is null or auth.uid() <> p_student_id then
    raise exception 'Not authorized';
  end if;

  select * into e from public.exams where id=p_exam_id and status='published';
  if not found then raise exception 'Exam not available'; end if;

  if not exists (
    select 1 from public.class_members cm
    join public.subjects s on s.class_id=cm.class_id
    where cm.student_id=p_student_id and s.id=e.subject_id
  ) then
    raise exception 'Student is not enrolled in this course';
  end if;

  if now() < e.start_time or now() >= e.end_time then
    raise exception 'Exam is not open';
  end if;

  select * into existing from public.exam_attempts
  where exam_id=p_exam_id and student_id=p_student_id;

  if found then
    if existing.status='in_progress' and existing.ends_at > now() then
      return query select existing.id, existing.ends_at;
      return;
    elsif existing.status='submitted' then
      raise exception 'Exam already submitted';
    end if;
  end if;

  v_end := least(e.end_time, now() + make_interval(mins => e.duration_minutes));

  insert into public.exam_attempts(exam_id,student_id,started_at,ends_at,status)
  values(e.id,p_student_id,now(),v_end,'in_progress')
  on conflict(exam_id,student_id) do update
  set started_at=excluded.started_at,
      ends_at=excluded.ends_at,
      status='in_progress',
      submitted_at=null,
      score=null
  returning id, ends_at into attempt_id, ends_at;

  return next;
end;
$$;

-- Server-side grading. It refuses to submit an already submitted attempt.
create or replace function public.submit_exam_attempt(p_attempt_id uuid)
returns table(score numeric, status text)
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.exam_attempts;
  total_points numeric := 0;
  earned numeric := 0;
  expired boolean := false;
begin
  select * into a from public.exam_attempts where id=p_attempt_id;
  if not found then raise exception 'Attempt not found'; end if;

  if auth.uid() <> a.student_id and not public.is_teacher() then
    raise exception 'Not authorized';
  end if;

  if a.status in ('submitted','expired') then
    return query select a.score, a.status::text;
    return;
  end if;

  expired := now() >= a.ends_at;

  select coalesce(sum(q.points),0)
  into total_points
  from public.questions q where q.exam_id=a.exam_id;

  select coalesce(sum(q.points),0)
  into earned
  from public.answers an
  join public.questions q on q.id=an.question_id
  join public.question_options qo on qo.id=an.selected_option_id and qo.is_correct=true
  where an.attempt_id=a.id;

  update public.exam_attempts
  set score=case when total_points=0 then 0 else round(earned/total_points*100,2) end,
      status=case when expired then 'expired'::attempt_status else 'submitted'::attempt_status end,
      submitted_at=now()
  where id=a.id
  returning exam_attempts.score, exam_attempts.status::text into score,status;

  return next;
end;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.subjects enable row level security;
alter table public.lessons enable row level security;
alter table public.materials enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.answers enable row level security;
alter table public.notifications enable row level security;

-- Drop/recreate policies safely
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies where schemaname='public'
    and tablename in ('profiles','classes','class_members','subjects','lessons','materials','exams','questions','question_options','exam_attempts','answers','notifications')
  loop
    execute format('drop policy if exists %I on public.%I',r.policyname,r.tablename);
  end loop;
end $$;

create policy profiles_select on public.profiles for select using (id=auth.uid() or public.is_teacher() or public.is_admin());
create policy profiles_update on public.profiles for update using (id=auth.uid() or public.is_admin()) with check (id=auth.uid() or public.is_admin());

create policy classes_teacher_all on public.classes for all using (teacher_id=auth.uid()) with check (teacher_id=auth.uid());
create policy classes_student_select on public.classes for select using (public.is_class_member(id));

create policy class_members_teacher_all on public.class_members for all
using (exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()))
with check (exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()));
create policy class_members_student_select on public.class_members for select using (student_id=auth.uid());

create policy subjects_teacher_all on public.subjects for all
using (exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()))
with check (exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()));
create policy subjects_student_select on public.subjects for select using (public.is_class_member(class_id));

create policy lessons_teacher_all on public.lessons for all
using (exists(select 1 from public.subjects s join public.classes c on c.id=s.class_id where s.id=subject_id and c.teacher_id=auth.uid()))
with check (exists(select 1 from public.subjects s join public.classes c on c.id=s.class_id where s.id=subject_id and c.teacher_id=auth.uid()));
create policy lessons_student_select on public.lessons for select using (
  exists(select 1 from public.subjects s where s.id=subject_id and public.is_class_member(s.class_id))
);

create policy materials_teacher_all on public.materials for all
using (exists(select 1 from public.lessons l join public.subjects s on s.id=l.subject_id join public.classes c on c.id=s.class_id where l.id=lesson_id and c.teacher_id=auth.uid()))
with check (exists(select 1 from public.lessons l join public.subjects s on s.id=l.subject_id join public.classes c on c.id=s.class_id where l.id=lesson_id and c.teacher_id=auth.uid()));
create policy materials_student_select on public.materials for select using (
  exists(select 1 from public.lessons l join public.subjects s on s.id=l.subject_id where l.id=lesson_id and public.is_class_member(s.class_id))
);

create policy exams_teacher_all on public.exams for all using (teacher_id=auth.uid()) with check (teacher_id=auth.uid());
create policy exams_student_select on public.exams for select using (
  status='published' and exists(select 1 from public.subjects s where s.id=subject_id and public.is_class_member(s.class_id))
);

create policy questions_teacher_all on public.questions for all using (
  exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
) with check (
  exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
);
create policy questions_student_select on public.questions for select using (
  exists(select 1 from public.exams e join public.subjects s on s.id=e.subject_id where e.id=exam_id and e.status='published' and public.is_class_member(s.class_id))
);

create policy options_teacher_all on public.question_options for all using (
  exists(select 1 from public.questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.teacher_id=auth.uid())
) with check (
  exists(select 1 from public.questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.teacher_id=auth.uid())
);
create policy options_student_select on public.question_options for select using (
  exists(select 1 from public.questions q join public.exams e on e.id=q.exam_id join public.subjects s on s.id=e.subject_id where q.id=question_id and e.status='published' and public.is_class_member(s.class_id))
);

create policy attempts_student_all on public.exam_attempts for select using (student_id=auth.uid());
create policy attempts_teacher_select on public.exam_attempts for select using (
  exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
);
create policy answers_student_all on public.answers for all using (
  exists(select 1 from public.exam_attempts a where a.id=attempt_id and a.student_id=auth.uid())
) with check (
  exists(select 1 from public.exam_attempts a where a.id=attempt_id and a.student_id=auth.uid() and a.status='in_progress' and now()<a.ends_at)
);
create policy answers_teacher_select on public.answers for select using (
  exists(select 1 from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.id=attempt_id and e.teacher_id=auth.uid())
);

create policy notifications_owner on public.notifications for all using (user_id=auth.uid()) with check (user_id=auth.uid());

-- Admin management policies
create policy classes_admin_all on public.classes for all using (public.is_admin()) with check (public.is_admin());
create policy class_members_admin_all on public.class_members for all using (public.is_admin()) with check (public.is_admin());
create policy subjects_admin_all on public.subjects for all using (public.is_admin()) with check (public.is_admin());
create policy lessons_admin_all on public.lessons for all using (public.is_admin()) with check (public.is_admin());
create policy materials_admin_all on public.materials for all using (public.is_admin()) with check (public.is_admin());
create policy exams_admin_all on public.exams for all using (public.is_admin()) with check (public.is_admin());
create policy questions_admin_all on public.questions for all using (public.is_admin()) with check (public.is_admin());
create policy options_admin_all on public.question_options for all using (public.is_admin()) with check (public.is_admin());
create policy attempts_admin_select on public.exam_attempts for select using (public.is_admin());
create policy answers_admin_select on public.answers for select using (public.is_admin());
create policy notifications_admin_all on public.notifications for all using (public.is_admin()) with check (public.is_admin());

-- Storage bucket
insert into storage.buckets(id,name,public)
values('materials','materials',false)
on conflict(id) do nothing;

drop policy if exists materials_storage_select on storage.objects;
drop policy if exists materials_storage_insert on storage.objects;
drop policy if exists materials_storage_update on storage.objects;
drop policy if exists materials_storage_delete on storage.objects;

create policy materials_storage_select on storage.objects
for select using (bucket_id='materials' and auth.role() in ('authenticated','anon'));

create policy materials_storage_insert on storage.objects
for insert to authenticated
with check (bucket_id='materials' and public.is_teacher());

create policy materials_storage_update on storage.objects
for update to authenticated
using (bucket_id='materials' and public.is_teacher());

create policy materials_storage_delete on storage.objects
for delete to authenticated
using (bucket_id='materials' and public.is_teacher());

-- OPTIONAL:
-- To expire attempts automatically even if a student is offline, enable pg_cron
-- in Supabase Dashboard and schedule a SQL job that calls a secure server-side
-- function. Keep this disabled until your deployment is ready.
