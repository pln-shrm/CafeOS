create table if not exists app_usage_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('bot', 'webapp')),
  user_identifier text not null,
  date_used date not null,
  unique (source, user_identifier, date_used)
);
