# BistroBot21 API Documentation

## REST Endpoints

### `GET /api/menu`
Returns the list of active menu items with their prices and categories.
- **Response**: `[ { id, name, price, category, ... } ]`

### `POST /api/orders`
Creates a new order from the POS.
- **Body**: 
  ```json
  {
    "customer_name": "String",
    "table_number": "String",
    "contact_info": "String",
    "items": [
      { "menu_item_id": 1, "quantity": 2, "price": 150 }
    ],
    "subtotal": 300,
    "tax_amount": 15,
    "total_amount": 315
  }
  ```
- **Response**: `200 OK`

### `POST /api/orders/bulk`
Creates multiple orders at once. Used for offline sync when the POS comes back online.
- **Body**: `{ "orders": [ { ...order_object } ] }`

### `GET /api/inventory/vendors`
Returns the list of configured vendors for stock ordering.

### `PATCH /api/inventory/vendors/:id/status`
Updates the WhatsApp onboarding status for a vendor.
- **Body**: `{ "status": "active" | "pending" }`

### `GET /api/reports/wastage`
Returns the daily wastage logs for the owner dashboard.

## Webhooks

### `POST /webhook`
Receives WhatsApp Cloud API webhook events. Handles incoming messages from the owner (for bot commands) and vendors (for onboarding or stock confirmation).

### `GET /webhook`
Verification endpoint for Meta's initial webhook registration challenge.
