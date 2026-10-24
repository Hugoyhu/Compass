-- Semester plan: future terms and the courses (or elective placeholders) in each.
-- Stored as JSON like [{"term": "2027-SP", "items": [{"code": "CSE 416"}, {"elective": 3}]}].
alter table student_profiles add column plan jsonb not null default '[]'::jsonb;
