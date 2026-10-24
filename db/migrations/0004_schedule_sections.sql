-- Class sections a student picked in the Schedule Builder, one row per term.
-- class_numbers are PeopleSoft class numbers, as in offering_sections.
create table schedule_sections (
  user_id       uuid not null references users (id) on delete cascade,
  term          text not null,
  class_numbers text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (user_id, term)
);
