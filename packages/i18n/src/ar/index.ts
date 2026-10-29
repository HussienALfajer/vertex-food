import { agreement } from './agreement.js';
import { audit } from './audit.js';
import { common } from './common.js';
import { staffConsole } from './console.js';
import { customer } from './customer.js';
import { driver } from './driver.js';
import { errors } from './errors.js';
import { hubClients } from './hub-clients.js';
import { messaging } from './messaging.js';
import { restaurant } from './restaurant.js';
import { sync } from './sync.js';
import { web } from './web.js';

/** The Arabic catalog, one namespace per file. */
export const ar = {
  common,
  errors,
  messaging,
  restaurant,
  sync,
  agreement,
  audit,
  hubClients,
  console: staffConsole,
  web,
  customer,
  driver,
};

export type Catalog = typeof ar;
