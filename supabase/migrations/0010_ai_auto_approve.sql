-- Phase 4b: optional auto-approval of assistant actions (default OFF). Deletes still always need a click:
-- ai_action_logs already refuses to execute a requires_confirmation action without approved_at.
alter table public.user_settings add column if not exists ai_auto_approve boolean not null default false;
