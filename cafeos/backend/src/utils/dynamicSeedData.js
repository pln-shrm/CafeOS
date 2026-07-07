require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { faker } = require('@faker-js/faker')
const { v4: uuidv4 } = require('uuid')
const { formatInTimeZone } = require('date-fns-tz')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const IST = 'Asia/Kolkata'

async function seed() {
  console.log('--- Seeding Dynamic Mock Data ---')

  // 1. Delete Existing Data (Order matters due to foreign keys)
  console.log('Clearing existing data...')
  
  // Clear order items
  await supabase.from('order_items').delete().neq('id', '00000000-0000-0000-0000-000000000000') // Deletes all
  
  // Clear orders
  await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Clear menu items
  await supabase.from('menu_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Clear staff (Assuming all staff in this table are workers, the owner uses auth.users)
  await supabase.from('staff').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Clear attendance
  await supabase.from('attendance').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})

  // Clear inventory tables if they exist (ignore errors if they don't)
  await supabase.from('inventory_levels').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})
  await supabase.from('inventory_deductions').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})

  // Clear vendor tables
  await supabase.from('vendor_credit').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})
  await supabase.from('procurement').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})
  await supabase.from('vendor_contacts').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})

  // Clear analytics
  await supabase.from('app_usage_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {}).catch(() => {})

  console.log('Existing data cleared.')

  // 2. Generate Staff
  console.log('\nGenerating Staff...')
  const exactStaffNames = ['Maria', 'Pritam', 'Ankit', 'Ritika']
  const pinHash = await bcrypt.hash('1234', 10)
  const staffMembers = []
  
  for (const name of exactStaffNames) {
    const staff = {
      name: name,
      role: 'staff',
      pin_hash: pinHash,
      active: true,
      daily_wage: faker.helpers.arrayElement([400, 500, 600])
    }
    const { data } = await supabase.from('staff').insert(staff).select().single()
    if (data) {
      staffMembers.push(data)
      console.log(`Generated Staff: ${data.name} (PIN: 1234)`)
    }
  }

  // 3. Generate Menu Items
  console.log('\nGenerating Menu Items...')
  const samsCafeMenu = [
    { name: 'Masala Tea', price: 25, category: 'Tea' },
    { name: 'Dalgona coffee', price: 100, category: 'Coffee' },
    { name: 'Cold Coffee', price: 120, category: 'Coffee' },
    { name: 'Fresh Lime soda', price: 80, category: 'Cold Drinks' },
    { name: 'Chikoo Milkshake', price: 120, category: 'Cold Drinks' },
    { name: 'ABC drink', price: 200, category: 'Cold Drinks' },
    { name: 'Cheese omelette', price: 100, category: 'Snacks' },
    { name: 'Poie Chicken Cafreal sandwich', price: 150, category: 'Snacks' },
    { name: 'Garlic poie', price: 80, category: 'Snacks' },
    { name: 'Nutella French Toast', price: 180, category: 'Desserts' },
    { name: 'Chicken Xacuti', price: 150, category: 'Main Course' },
    { name: 'Veg xacutti masala', price: 120, category: 'Main Course' },
    { name: 'Korean Cheesy Garlic Bun', price: 300, category: 'Snacks' },
    { name: 'Ribbon sandwich (Veg)', price: 120, category: 'Snacks' },
    { name: 'Fish Cutlets', price: 200, category: 'Snacks' },
    { name: 'Chicken drumsticks cafreal', price: 180, category: 'Main Course' }
  ]
  const menuItemsToInsert = samsCafeMenu.map(item => ({ ...item, active: true }))

  // Deduplicate by name
  const uniqueItems = Array.from(new Map(menuItemsToInsert.map(item => [item.name, item])).values())
  const { data: insertedMenu, error: menuErr } = await supabase.from('menu_items').insert(uniqueItems).select()
  if (menuErr) {
     console.error('Failed to insert menu items:', menuErr)
     process.exit(1)
  }
  console.log(`Generated ${insertedMenu.length} menu items.`)

  // 4. Generate Orders for the past 10 days
  console.log('\nGenerating Orders for the past 10 days...')
  
  const numOrders = faker.number.int({ min: 100, max: 150 })
  const orderTypes = ['dine_in', 'takeaway']
  const paymentMethods = ['cash', 'upi']
  
  // Create orders
  let successCount = 0
  for (let i = 0; i < numOrders; i++) {
    // Generate date within the past 10 days
    const pastDate = faker.date.recent({ days: 10 })
    const billDate = formatInTimeZone(pastDate, IST, 'yyyy-MM-dd')
    
    // Pick random staff
    const staff = faker.helpers.arrayElement(staffMembers)
    
    // Determine order details
    const orderType = faker.helpers.arrayElement(orderTypes)
    let tableNumber = null
    let customerName = faker.person.firstName()
    
    if (orderType === 'dine_in') {
      tableNumber = String(faker.number.int({ min: 1, max: 10 }))
    } else if (orderType === 'swiggy' || orderType === 'zomato') {
      customerName = orderType.toUpperCase() + ' - ' + customerName
    }

    // Pick items
    const numItems = faker.number.int({ min: 1, max: 5 })
    const orderItems = faker.helpers.arrayElements(insertedMenu, numItems)
    
    let total = 0
    const orderItemsToInsert = []
    
    for (const mItem of orderItems) {
      const quantity = faker.number.int({ min: 1, max: 3 })
      total += mItem.price * quantity
      orderItemsToInsert.push({
        menu_item_id: mItem.id,
        quantity: quantity,
        unit_price: mItem.price,
        discount_amount: 0
      })
    }
    
    // Get next bill number (simulation)
    const { data: lastOrder } = await supabase
      .from('orders')
      .select('bill_number')
      .eq('bill_date', billDate)
      .order('bill_number', { ascending: false })
      .limit(1)
      .maybeSingle()
      
    const billNumber = lastOrder && lastOrder.bill_number ? lastOrder.bill_number + 1 : 1

    const orderData = {
      local_uuid: uuidv4(),
      order_type: orderType,
      payment_method: faker.helpers.arrayElement(paymentMethods),
      total: total,
      bill_number: billNumber,
      bill_date: billDate,
      staff_id: staff.id,
      table_number: tableNumber,
      customer_name: customerName,
      status: 'completed',
      timestamp: pastDate.toISOString()
    }

    const { data: insertedOrder, error: orderErr } = await supabase.from('orders').insert(orderData).select().single()
    if (orderErr) {
      console.error('Error inserting order:', orderErr.message)
      continue
    }

    // Insert items
    for (const oi of orderItemsToInsert) {
      oi.order_id = insertedOrder.id
    }
    const { error: oiErr } = await supabase.from('order_items').insert(orderItemsToInsert)
    if (!oiErr) {
      successCount++
    }
  }

  // 5. Generate Attendance for the past 10 days
  console.log('\nGenerating Attendance for the past 10 days...')
  let attendanceCount = 0
  for (const staff of staffMembers) {
    for (let d = 0; d < 10; d++) {
      // 80% chance of being present
      if (faker.number.int({ min: 1, max: 100 }) <= 80) {
        const pastDate = new Date()
        pastDate.setDate(pastDate.getDate() - d)
        const dateStr = formatInTimeZone(pastDate, IST, 'yyyy-MM-dd')
        
        // Random check-in time between 8 AM and 11 AM
        const hour = faker.number.int({ min: 8, max: 11 })
        const min = faker.number.int({ min: 0, max: 59 })
        pastDate.setHours(hour, min, 0, 0)
        
        const isLate = hour > 10 || (hour === 10 && min > 0)
        const reasons = ['Traffic', 'Bus was late', 'Raining', 'Not feeling well', null, null, null]
        
        const attendanceRecord = {
          staff_id: staff.id,
          date: dateStr,
          check_in_time: pastDate.toISOString(),
          late: isLate,
          late_reason: isLate ? faker.helpers.arrayElement(reasons) : null
        }
        
        const { error: attErr } = await supabase.from('attendance').insert(attendanceRecord)
        if (!attErr) attendanceCount++
      }
    }
  }

  // 6. Generate Vendor Contacts & Credits
  console.log('\nGenerating Vendor Data...')
  const vendorNames = ['Goa Dairy Co.', 'Panjim Fresh Produce', 'Baga Bakery Supplies', 'Coffee Roasters Inc.']
  for (const v of vendorNames) {
    await supabase.from('vendor_contacts').insert({
      name: v,
      whatsapp_number: '919876543210',
      active: true
    }).then(() => {}).catch(() => {})
  }

  let procurementCount = 0
  let creditCount = 0
  for (let d = 0; d < 10; d++) {
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - d)
    const dateStr = formatInTimeZone(pastDate, IST, 'yyyy-MM-dd')
    
    // 60% chance to have an order from a vendor today
    if (faker.number.int({ min: 1, max: 100 }) <= 60) {
      const v = faker.helpers.arrayElement(vendorNames)
      const cost = faker.number.int({ min: 500, max: 3000 })
      
      const { data: proc } = await supabase.from('procurement').insert({
        vendor_name: v,
        items_json: [{ name: 'Assorted Supplies', qty: 1, price_per_unit: cost }],
        total_cost: cost,
        delivery_date: dateStr,
        status: faker.helpers.arrayElement(['pending_delivery', 'delivered']),
        timestamp: pastDate.toISOString()
      }).select().single()
      
      if (proc) {
        procurementCount++
        
        // Add credit entry (outstanding)
        await supabase.from('vendor_credit').insert({
          vendor_name: v,
          type: 'credit',
          amount: cost,
          item_description: `Order ${proc.id.split('-')[0]}`,
          settled: false,
          timestamp: pastDate.toISOString()
        })
        creditCount++
        
        // 50% chance to also log a payment
        if (faker.number.int({ min: 1, max: 100 }) <= 50) {
          const payAmount = faker.helpers.arrayElement([cost, Math.floor(cost / 2)])
          await supabase.from('vendor_credit').insert({
            vendor_name: v,
            type: 'payment',
            amount: payAmount,
            item_description: 'Payment for supplies',
            settled: false,
            timestamp: pastDate.toISOString()
          })
          creditCount++
        }
      }
    }
  }

  // 7. Generate App Usage Logs
  console.log('\nGenerating Analytics Usage Logs...')
  let usageCount = 0
  for (let d = 0; d < 10; d++) {
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - d)
    const dateStr = formatInTimeZone(pastDate, IST, 'yyyy-MM-dd')
    
    // Simulate daily bot usage (staff)
    if (faker.number.int({ min: 1, max: 100 }) <= 90) {
      const staff = faker.helpers.arrayElement(staffMembers)
      await supabase.from('app_usage_logs').insert({
        source: 'bot',
        user_identifier: staff.id,
        date_used: dateStr
      })
      usageCount++
    }

    // Simulate daily webapp usage (owner)
    if (faker.number.int({ min: 1, max: 100 }) <= 70) {
      await supabase.from('app_usage_logs').insert({
        source: 'webapp',
        user_identifier: 'owner',
        date_used: dateStr
      })
      usageCount++
    }
  }

  console.log(`\n--- Seeding Complete ---`)
  console.log(`Generated ${successCount} successful mock orders.`)
  console.log(`Generated ${attendanceCount} attendance records.`)
  console.log(`Generated ${procurementCount} vendor orders and ${creditCount} credit logs.`)
  console.log(`Generated ${usageCount} analytics app usage logs.`)
  console.log(`Worker PINs are set to '1234'.`)
}

seed()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Seed script failed:', err)
    process.exit(1)
  })
