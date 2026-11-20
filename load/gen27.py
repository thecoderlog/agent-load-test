#!/usr/bin/env python3
"""gen27.py: the shop's data, the same every time (fixed random seed).

  python3 gen27.py small <dir>   300 products, 2,000 orders: the written tests' fixtures (tests/fixtures)
  python3 gen27.py big <dir>     100,000 products, 2,000,000 orders: what the load test runs against

Writes products.csv, orders.csv, order_lines.csv (header row, comma separated, no quoting needed) and meta.json.
In the mid and big sets, HOT_SKUS (5 products) have stock 500 and every other product has 1,000,000, so the only orders
that should ever be refused for stock are the hot ones. Orders span the 365 UTC days up to END_DAY.
"""
import json, os, random, sys
from datetime import datetime, timedelta, timezone

ADJ = ['red', 'blue', 'green', 'black', 'white', 'oak', 'steel', 'linen', 'cotton', 'glass', 'stone', 'copper', 'wool',
       'bamboo', 'velvet', 'matte', 'glossy', 'tiny', 'large', 'classic', 'modern', 'rustic', 'soft', 'heavy']
NOUN = ['mug', 'bowl', 'plate', 'lamp', 'chair', 'table', 'towel', 'pillow', 'blanket', 'vase', 'basket', 'shelf',
        'clock', 'mirror', 'candle', 'jar', 'teapot', 'kettle', 'spoon', 'knife', 'board', 'rug', 'stool', 'frame']
CATS = ['kitchen', 'dining', 'bath', 'bedroom', 'living', 'garden', 'office', 'kids', 'lighting', 'storage', 'decor', 'textiles']
END_DAY = datetime(2026, 11, 18, tzinfo=timezone.utc)  # last full day of seeded orders
SIZES = {'small': (300, 2000, 200), 'mid': (20_000, 200_000, 20_000), 'big': (100_000, 2_000_000, 200_000)}  # mid: kit tests only  # products, orders, customers
HOT_SKUS = [f'P{n:06d}' for n in range(101, 106)]
HOT_STOCK = 500
BIG_STOCK = 1_000_000


def sku(n):
    return f'P{n:06d}'


def main():
    size, out = sys.argv[1], sys.argv[2]
    n_prod, n_orders, n_cust = SIZES[size]
    rnd = random.Random(27)
    os.makedirs(out, exist_ok=True)
    prices = {}
    with open(os.path.join(out, 'products.csv'), 'w') as f:
        f.write('sku,name,category,price_cents,stock\n')
        for i in range(1, n_prod + 1):
            name = f'{rnd.choice(ADJ).capitalize()} {rnd.choice(ADJ)} {rnd.choice(NOUN)} {rnd.randint(1, 999)}'
            price = rnd.randint(199, 19999)
            prices[sku(i)] = price
            if size != 'small':
                stock = HOT_STOCK if sku(i) in HOT_SKUS else BIG_STOCK
            else:
                stock = rnd.choice([0, 1, 2, 3, 5, 8, 10, 20, 50, 100])
            f.write(f'{sku(i)},{name},{rnd.choice(CATS)},{price},{stock}\n')
    start = END_DAY - timedelta(days=364)
    span = 365 * 86400
    times = sorted(rnd.randrange(span) for _ in range(n_orders))  # ids go up with time, like a real shop
    n_lines = 0
    with open(os.path.join(out, 'orders.csv'), 'w') as fo, open(os.path.join(out, 'order_lines.csv'), 'w') as fl:
        fo.write('id,customer_id,created_at,total_cents\n')
        fl.write('order_id,sku,qty,price_cents\n')
        for oid, t in enumerate(times, start=1):
            k = rnd.choice([1, 1, 2, 2, 3, 4])
            picks = set()
            while len(picks) < k:
                # popular products sell more: a skewed pick over the whole range
                picks.add(min(n_prod, int(n_prod * rnd.random() ** 2.2) + 1))
            total = 0
            for p in sorted(picks):
                q = rnd.randint(1, 4)
                total += q * prices[sku(p)]
                fl.write(f'{oid},{sku(p)},{q},{prices[sku(p)]}\n')
                n_lines += 1
            ts = (start + timedelta(seconds=t)).strftime('%Y-%m-%d %H:%M:%S+00')
            fo.write(f'{oid},{rnd.randint(1, n_cust)},{ts},{total}\n')
    meta = {'size': size, 'products': n_prod, 'orders': n_orders, 'order_lines': n_lines, 'customers': n_cust,
            'max_order_id': n_orders, 'first_day': start.strftime('%Y-%m-%d'), 'last_day': END_DAY.strftime('%Y-%m-%d'),
            'hot_skus': HOT_SKUS if size != 'small' else [], 'hot_stock': HOT_STOCK}
    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta))


if __name__ == '__main__':
    main()
