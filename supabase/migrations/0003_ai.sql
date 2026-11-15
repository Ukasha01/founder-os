-- 0003_ai.sql
-- AI conversations, messages and the auditable action log.
-- Created before tasks so task_activity can reference ai_action_logs.

create table public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id)
);
create index ai_conversations_owner_created on public.ai_conversations (owner_id, created_at desc);
create trigger ai_conversations_updated before update on public.ai_conversations
  for each row execute function public.set_updated_at();

create table public.ai_messages (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id   uuid not null,
  role              text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content           text,
  input_mode        text check (input_mode in ('text', 'voice')),
  detected_language text,                 -- 'en' | 'ur' | 'roman-ur' | 'mixed'
  tool_calls        jsonb,
  model             text,
  created_at        timestamptz not null default now(),
  foreign key (conversation_id, owner_id)
    references public.ai_conversations (id, owner_id) on delete cascade,
  unique (id, owner_id)
);
create index ai_messages_conversation on public.ai_messages (conversation_id, created_at);

-- One row per tool invocation Gemini proposes. Every action is validated server-side
-- BEFORE running; the original proposal is immutable (enforced by column-level grants in 0010).
create table public.ai_action_logs (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id      uuid,
  message_id           uuid,
  tool_name            text not null,
  tool_kind            text not null check (tool_kind in ('read', 'write')),
  proposed_input       jsonb not null,       -- exactly what the model asked for
  validated_input      jsonb,                -- after schema + ownership validation
  preview              jsonb,                -- human-readable preview shown before approval
  requires_confirmation boolean not null default false,  -- deletes and bulk changes
  status               text not null default 'proposed'
                         check (status in ('proposed', 'awaiting_approval', 'approved', 'rejected',
                                           'executing', 'executed', 'failed', 'cancelled')),
  result               jsonb,
  error                text,
  write_verified       boolean,              -- true only after the write was read back from the DB
  affected_entity_type text,
  affected_entity_ids  uuid[],
  model                text,
  idempotency_key      text,
  created_at           timestamptz not null default now(),
  approved_at          timestamptz,
  executed_at          timestamptz,
  foreign key (conversation_id, owner_id)
    references public.ai_conversations (id, owner_id) on delete set null (conversation_id),
  foreign key (message_id, owner_id)
    references public.ai_messages (id, owner_id) on delete set null (message_id),
  unique (id, owner_id),
  unique (owner_id, idempotency_key),
  -- A write can only be recorded as executed after it was verified against the database.
  constraint ai_write_must_be_verified
    check (not (status = 'executed' and tool_kind = 'write' and coalesce(write_verified, false) = false)),
  -- Actions that need confirmation cannot run without a recorded approval.
  constraint ai_confirmation_required
    check (not (requires_confirmation and status in ('executing', 'executed') and approved_at is null))
);
create index ai_action_logs_owner_created on public.ai_action_logs (owner_id, created_at desc);
create index ai_action_logs_status on public.ai_action_logs (owner_id, status);
