# Orders and reports

An order, wherever one appears in a response:

```json
{
  "id": 2001,
  "customer_id": 17,
  "created_at": "2026-11-19T10:04:12.345Z",
  "total_cents": 4097,
  "lines": [
    {"sku": "P000007", "qty": 2, "price_cents": 1299},
    {"sku": "P000042", "qty": 1, "price_cents": 1499}
  ]
}
```

`lines` are sorted by `sku`. `total_cents` is the sum of `qty * price_cents` over the lines.

## POST /orders
Place an order. Body:

```json
{"customer_id": 17, "lines": [{"sku": "P000042", "qty": 1}, {"sku": "P000007", "qty": 2}]}
```

- `customer_id` is a whole number of 1 or more.
- `lines` has 1 to 10 entries. Each `qty` is a whole number from 1 to 20. The same sku can't appear twice.
- Anything else wrong with the body (missing fields, wrong types, not JSON) is 400 `bad_request`.
- A sku that doesn't exist is 404 `not_found`, with `"sku"` in the body: `{"error": "not_found", "sku": "P999999"}`.
- If any line asks for more than that product's `stock`, the answer is 409 `out_of_stock` with that sku:
  `{"error": "out_of_stock", "sku": "P000042"}`, and nothing changes: no order, no stock taken.
- Otherwise the order is saved, each product's `stock` goes down by its line's `qty`, each line's `price_cents`
  is the product's current price, and the answer is 201 with the order.

## GET /orders/:id
The order, or 404 `not_found`.

## GET /customers/:id/orders
A customer's most recent orders, newest first (by `created_at`, then by `id`, both descending).
`limit` is a whole number from 1 to 50, default 10. Response:

```json
{"items": [{"id": 1990, "created_at": "2026-11-17T08:00:00.000Z", "total_cents": 52661}]}
```

A customer with no orders gets `{"items": []}`.

## GET /reports/top-products?date=YYYY-MM-DD
The best sellers on one UTC day: every order whose `created_at` falls on that date. For each sku sold that day,
`units` is the sum of `qty` and `revenue_cents` is the sum of `qty * price_cents`. Sorted by `units` descending,
then `sku` ascending. `limit` is a whole number from 1 to 50, default 10. `date` is required.

```json
{"date": "2026-11-18", "items": [{"sku": "P000003", "name": "Oak stone bowl 5", "units": 14, "revenue_cents": 41986}]}
```

A day with no orders gets `{"date": "...", "items": []}`. A missing or invalid `date` is 400 `bad_request`.
