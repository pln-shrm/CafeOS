-- Run this in Supabase SQL editor to create the telemetry table

create table if not exists handler_logs (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  handler_name text not null,
  phone_number text not null,
  outcome text not null,
  duration_ms integer not null,
  error_message text,
  logged_at timestamptz not null default now()
);

-- Optional: Create an index for faster queries on handler and outcome
create index if not exists idx_handler_logs_handler on handler_logs(handler_name);
create index if not exists idx_handler_logs_outcome on handler_logs(outcome);
