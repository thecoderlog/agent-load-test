# Products

A product, wherever one appears in a response:

```json
{"sku": "P000042", "name": "Blue linen towel 17", "category": "bath", "price_cents": 1299, "stock": 8}
```

## GET /products/:sku
The product with that sku, or 404 `not_found`.

## GET /products
Search the products.

| query parameter | meaning | default |
|---|---|---|
| `q` | only products whose `name` contains this text, ignoring upper and lower case | all products |
| `category` | only products in this category (exact match) | all categories |
| `limit` | how many to return, a whole number from 1 to 100 | 20 |
| `offset` | how many matches to skip first, a whole number from 0 | 0 |

`q` and `category` can be combined. Matches are sorted by `name`, then by `sku`, both ascending, comparing
byte by byte (`COLLATE "C"` in PostgreSQL).

Response:

```json
{"total": 57, "items": [ /* up to `limit` products */ ]}
```

`total` is the number of all matches, before `limit` and `offset`. A search with no matches answers 200 with
`{"total": 0, "items": []}`. A `limit` or `offset` that is not a whole number in range answers 400 `bad_request`.
