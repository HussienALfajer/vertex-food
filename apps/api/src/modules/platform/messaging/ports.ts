import type { Database, Transaction } from '@vertex-food/db';

// What messaging needs from the modules that own the data (spec S03): declared here, provided by
// identity.

/** The names of platform users (owned by identity), for the admin named on a session's events. */
export interface PlatformUserNames {
  /** Each user's name by id, archived users included: events outlive the people who acted. */
  names(db: Database | Transaction, ids: readonly string[]): Promise<Map<string, string>>;
}

export const PLATFORM_USER_NAMES = Symbol('PlatformUserNames');
