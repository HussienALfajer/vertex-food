// Synthetic fixtures. Fixed ids so the scenarios can refer to them. No real restaurant, staff or customer data.
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const BUSINESS_DAY = '2026-11-01';
export const CURRENCY = 'SYP';

export const IDS = {
  tenantA: id(1),
  branchA: id(2),
  tenantB: id(3),
  branchB: id(4),
  pc1: id(10), // the hub PC (cashier 1)
  pc2: id(11), // the standby PC (cashier 2)
  pcOther: id(12), // a PC of tenant B
  cashier: id(20),
  waiter: id(21),
  cook: id(22),
  itemShawarma: id(30),
  itemBurger: id(31),
  itemJuice: id(32),
  itemFries: id(33),
  itemOther: id(39),
  priceShawarma: id(40),
  priceBurger: id(41),
  priceJuice: id(42),
  priceFries: id(43),
  priceOther: id(49),
  tables: [id(50), id(51), id(52), id(53)],
};

const ITEMS = [
  [IDS.itemShawarma, IDS.priceShawarma, 'Synthetic shawarma', 'grill', 3500000],
  [IDS.itemBurger, IDS.priceBurger, 'Synthetic burger', 'grill', 4200000],
  [IDS.itemJuice, IDS.priceJuice, 'Synthetic lemon mint', 'juice', 1500000],
  [IDS.itemFries, IDS.priceFries, 'Synthetic fries', 'grill', 1200000],
];

export async function seed(db) {
  await db.query('TRUNCATE command_log, order_events, payments, kitchen_tickets, order_lines, orders, number_ranges, dining_tables, prices, menu_items, devices');
  const { tenantA: t, branchA: b } = IDS;
  await db.query(
    `INSERT INTO devices (id, tenant_id, branch_id, name) VALUES ($1,$4,$5,'cashier-1'), ($2,$4,$5,'cashier-2'), ($3,$6,$7,'other-tenant')`,
    [IDS.pc1, IDS.pc2, IDS.pcOther, t, b, IDS.tenantB, IDS.branchB],
  );
  for (const [item, price, name, station, amount] of ITEMS) {
    await db.query('INSERT INTO menu_items VALUES ($1,$2,$3,$4,$5)', [item, t, b, name, station]);
    await db.query('INSERT INTO prices VALUES ($1,$2,$3,$4,$5,$6,$7)', [price, t, b, item, amount, CURRENCY, '2026-10-01T00:00:00Z']);
  }
  await db.query('INSERT INTO menu_items VALUES ($1,$2,$3,$4,$5)', [IDS.itemOther, IDS.tenantB, IDS.branchB, 'Synthetic other', 'grill']);
  await db.query('INSERT INTO prices VALUES ($1,$2,$3,$4,$5,$6,$7)', [IDS.priceOther, IDS.tenantB, IDS.branchB, IDS.itemOther, 100, CURRENCY, '2026-10-01T00:00:00Z']);
  for (const [i, tableId] of IDS.tables.entries()) {
    await db.query('INSERT INTO dining_tables VALUES ($1,$2,$3,$4)', [tableId, t, b, `T${i + 1}`]);
  }
  return { ok: true };
}
