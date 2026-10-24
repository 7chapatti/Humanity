-- The core image behind each draft, and the model's original text when the
-- editor changes it before approving (edit history: draft vs final).

alter table public.posts
  add column image text check (image is null or char_length(image) <= 120),
  add column original_content text check (original_content is null or char_length(original_content) <= 1000);

-- Approved and posted posts feed back into prompts as the standard to match.
create index posts_reviewed_idx on public.posts (reviewed_at desc) where status in ('approved', 'posted');
