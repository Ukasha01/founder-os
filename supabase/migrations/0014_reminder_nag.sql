alter table public.reminders add column if not exists acked_at timestamptz, add column if not exists nag_count integer not null default 0, add column if not exists next_nag_at timestamptz;
create index if not exists reminders_nag_idx on public.reminders (next_nag_at) where acked_at is null and next_nag_at is not null;
