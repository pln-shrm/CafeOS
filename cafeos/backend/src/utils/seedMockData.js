require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function seed() {
  console.log('Seeding mock data...')

  // 1. Seed Menu Items
  const menuItems = [
    { name: 'Espresso', price: 120, category: 'Coffee', active: true },
    { name: 'Cappuccino', price: 180, category: 'Coffee', active: true },
    { name: 'Latte', price: 190, category: 'Coffee', active: true },
    { name: 'Iced Americano', price: 150, category: 'Coffee', active: true },
    { name: 'Masala Chai', price: 80, category: 'Tea', active: true },
    { name: 'Green Tea', price: 100, category: 'Tea', active: true },
    { name: 'Classic Croissant', price: 150, category: 'Snacks', active: true },
    { name: 'Chocolate Brownie', price: 200, category: 'Desserts', active: true },
    { name: 'Veg Sandwich', price: 160, category: 'Snacks', active: true },
    { name: 'Lemon Iced Tea', price: 140, category: 'Cold Drinks', active: true },
    { name: 'Mango Smoothie', price: 220, category: 'Cold Drinks', active: true },
    { name: 'French Fries', price: 130, category: 'Snacks', active: true }
  ]

  for (const item of menuItems) {
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id')
      .ilike('name', item.name)
      .maybeSingle()

    if (!existing) {
      const { error } = await supabase.from('menu_items').insert(item)
      if (error) {
        console.error(`Failed to insert menu item ${item.name}:`, error.message)
      } else {
        console.log(`Inserted menu item: ${item.name}`)
      }
    } else {
      console.log(`Menu item already exists: ${item.name}`)
    }
  }

  // 2. Seed Mock Staff (Worker)
  const pinHash = await bcrypt.hash('1234', 10)
  const staffMember = {
    name: 'Rahul (Test)',
    role: 'staff',
    pin_hash: pinHash,
    active: true,
    daily_wage: 500
  }

  const { data: existingStaff } = await supabase
    .from('staff')
    .select('id')
    .eq('name', staffMember.name)
    .maybeSingle()

  if (!existingStaff) {
    const { error } = await supabase.from('staff').insert(staffMember)
    if (error) {
      console.error('Failed to insert mock staff:', error.message)
    } else {
      console.log('Inserted mock staff: Rahul (Test) with PIN 1234')
    }
  } else {
    console.log('Mock staff already exists: Rahul (Test)')
  }

  // Note: Owner user must be created via Supabase Auth dashboard or sign-up endpoint.
  // Assuming the owner is already created or will be created manually.
  console.log('\n--- Seeding Complete ---')
  console.log('Test Owner: Please ensure you have created an owner account via Supabase Auth.')
  console.log('Test Worker: Rahul (Test) | PIN: 1234')
}

seed()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Seed script failed:', err)
    process.exit(1)
  })
