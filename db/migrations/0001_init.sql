-- Compass core schema. Plain PostgreSQL (13+): runs unchanged on Tiger Data,
-- Supabase, or any other Postgres. Vendor-specific features go in separate
-- optional migration folders (e.g. db/migrations/tiger/).

-- ---------------------------------------------------------------------------
-- Catalog (loaded from data/catalog by scripts/db-load.ts; the JSON files stay
-- the source of truth). Full records live in `data` (validated by the Zod
-- schemas); a few columns are pulled out for querying.
-- ---------------------------------------------------------------------------

create table courses (
  code        text primary key,
  subject     text not null,
  number      integer not null,
  title       text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index courses_subject_number on courses (subject, number);

-- The prerequisite graph: one edge per course referenced in a course's
-- prerequisite tree. requires_code may name a course not in `courses`.
create table course_requisites (
  course_code    text not null references courses (code) on delete cascade,
  requires_code  text not null,
  kind           text not null check (kind in ('prerequisite', 'corequisite')),
  primary key (course_code, requires_code, kind)
);
create index course_requisites_requires on course_requisites (requires_code);

create table programs (
  id             text primary key,
  name           text not null,
  kind           text not null check (kind in ('major', 'minor')),
  review_status  text not null,
  data           jsonb not null,
  updated_at     timestamptz not null default now()
);

create table offering_sections (
  term          text not null,
  class_number  text not null,
  course_code   text not null,
  section       text not null,
  component     text not null,
  session       text not null,
  campus        text not null,
  meetings      jsonb not null default '[]',
  primary key (term, class_number)
);
create index offering_sections_course on offering_sections (course_code, term);

-- Where the loaded catalog came from (e.g. demo vs. real course data).
create table catalog_meta (
  key    text primary key,
  value  jsonb not null
);

-- ---------------------------------------------------------------------------
-- Accounts: username + password, server-side sessions.
-- ---------------------------------------------------------------------------

create table users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);
create unique index users_username_lower on users (lower(username));

-- Stores a SHA-256 hash of the session token, never the token itself.
create table sessions (
  id          text primary key,
  user_id     uuid not null references users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index sessions_user on sessions (user_id);

-- ---------------------------------------------------------------------------
-- Student records (one per account).
-- ---------------------------------------------------------------------------

create table student_profiles (
  user_id       uuid primary key references users (id) on delete cascade,
  name          text not null default '',
  entry_term    text not null,
  current_term  text not null,
  program_ids   text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

create table course_attempts (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references users (id) on delete cascade,
  position  integer not null,
  code      text not null,
  source    text not null check (source in ('sbu', 'transfer', 'ap')),
  term      text,
  grade     text,
  status    text not null check (status in ('completed', 'in-progress')),
  credits   numeric(5, 2),
  origin    text,
  title     text,
  sbc       text[]
);
create index course_attempts_user on course_attempts (user_id, position);
