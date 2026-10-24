-- The editor's "why it works" note on an approved post. It travels with the
-- post into future prompts, so the writer learns the technique, not the words.
alter table public.posts
  add column note text check (note is null or char_length(note) <= 300);
