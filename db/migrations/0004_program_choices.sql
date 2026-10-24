-- Declared concentrations, specializations, and tracks: {"<choice rule id>": "<alternative id>"}.
alter table student_profiles add column choices jsonb not null default '{}'::jsonb;
