# CafeOS Database Migrations

This directory contains the SQL migrations required to set up the CafeOS / CafeOS database on Supabase.

## Execution Order

The migrations must be executed in numerical order:

1. `001_ingredient_master.sql` — Creates the ingredients, suppliers, and procurement tables, along with trigger functions to log stock changes.
2. `002_inventory_sync.sql` — Adds the `increment_inventory` function for atomic inventory updates.
3. `003_handler_logs.sql` — Creates the `handler_logs` table used by the WhatsApp bot for telemetry and debugging.

## How to Apply Migrations

**Using the Supabase Dashboard:**
1. Open your Supabase project.
2. Navigate to the **SQL Editor**.
3. Create a new query.
4. Copy the contents of `001_ingredient_master.sql`, paste it, and run it.
5. Repeat for `002` and `003`.

**Using Supabase CLI:**
If you have the Supabase CLI installed, you can push these to your linked remote project:
```bash
supabase db push
```

## Note on Main Schema
The main application tables (`users`, `orders`, `menu_items`, `bot_state`) are typically created via the Supabase Dashboard UI or exist in an initial schema dump. These migration files specifically cover the inventory management and bot logging patches added later in development.
