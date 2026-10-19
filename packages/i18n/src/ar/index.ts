import { common } from './common.js';
import { staffConsole } from './console.js';
import { customer } from './customer.js';
import { driver } from './driver.js';
import { errors } from './errors.js';
import { restaurant } from './restaurant.js';
import { web } from './web.js';

/** The Arabic catalog, one namespace per file. */
export const ar = { common, errors, restaurant, console: staffConsole, web, customer, driver };

export type Catalog = typeof ar;
