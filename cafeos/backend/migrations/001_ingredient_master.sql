-- Run this in Supabase SQL editor

-- What Sam buys from vendors
create table if not exists ingredient_master (
  id             serial primary key,
  name           text        not null,
  unit           text        not null,          -- "kg", "L", "pieces", "g"
  cost_per_unit  numeric(8,2),                  -- for auto-credit calculation
  vendor_item_name text,                        -- how the vendor knows it (if different)
  active         boolean     not null default true,
  created_at     timestamptz not null default now(),
  constraint ingredient_master_name_key unique (name)
);

-- Recipe: how many units of each ingredient per portion of a menu item
create table if not exists menu_item_ingredients (
  id                   serial primary key,
  menu_item_id         integer not null references menu_items(id) on delete cascade,
  ingredient_id        integer not null references ingredient_master(id) on delete cascade,
  quantity_per_portion numeric(10,4) not null check (quantity_per_portion > 0),
  constraint menu_item_ingredients_unique unique (menu_item_id, ingredient_id)
);

-- Current stock on hand per ingredient
create table if not exists inventory_levels (
  ingredient_id integer primary key references ingredient_master(id) on delete cascade,
  current_qty   numeric(10,3) not null default 0 check (current_qty >= 0),
  last_updated  timestamptz not null default now()
);

-- Anomaly resolution log (used by handleAnomalyResolutionReply)
create table if not exists anomaly_logs (
  id                  uuid primary key default gen_random_uuid(),
  date                date        not null,
  menu_item_id        integer     references menu_items(id),
  item_name           text,
  implied_consumption integer,
  sold_qty            integer,
  resolution_reason   text,
  logged_at           timestamptz not null default now()
);
