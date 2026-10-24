-- The fewest credits a student wants per fall/spring term; null means the default (12).
alter table student_profiles add column min_term_credits smallint;
