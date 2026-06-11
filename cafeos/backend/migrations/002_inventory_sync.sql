-- Run this in Supabase SQL editor (after 001_ingredient_master.sql)

-- Atomic stock adjustment: positive qty for deliveries, negative for consumption.
-- Clamps at 0 so theoretical over-consumption never goes negative.
create or replace function increment_inventory(p_ingredient_id integer, p_qty numeric)
returns void
language sql
as $$
  insert into inventory_levels (ingredient_id, current_qty, last_updated)
  values (p_ingredient_id, greatest(p_qty, 0), now())
  on conflict (ingredient_id)
  do update set
    current_qty = greatest(inventory_levels.current_qty + p_qty, 0),
    last_updated = now();
$$;

-- Tracks which dates have had theoretical consumption deducted from stock,
-- so the nightly deduction job is idempotent (never double-subtracts a day).
create table if not exists inventory_deductions (
  date       date primary key,
  applied_at timestamptz not null default now()
);

-- Owner-flagged demand events ("big group tomorrow", "college fest Saturday").
-- Read by the prediction engine as a demand multiplier for that date.
create table if not exists event_flags (
  id                serial primary key,
  date              date not null,
  description       text,
  demand_multiplier numeric(4,2) not null default 1.30
    check (demand_multiplier > 0 and demand_multiplier <= 3),
  created_at        timestamptz not null default now()
);

create index if not exists event_flags_date_idx on event_flags(date);
