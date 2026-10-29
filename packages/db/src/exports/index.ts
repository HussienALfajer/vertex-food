import { staffDataset } from './access.js';
import { auditLogDataset } from './audit.js';
import { agreementTermsDataset } from './commercial.js';
import type { ExportDataset } from './dataset.js';
import { entitlementsDataset } from './entitlements.js';
import { devicesDataset } from './identity.js';
import { syncAttentionDataset } from './sync.js';
import {
  branchChargesDataset,
  branchesDataset,
  branchHourExceptionsDataset,
  branchHoursDataset,
  restaurantDataset,
} from './tenancy.js';

export {
  byPages,
  EXPORT_PAGE_SIZE,
  type ExportDataset,
  type ExportFile,
  type ExportScope,
} from './dataset.js';
export { exportFilePath } from './tenancy.js';

/**
 * Every dataset of the restaurant's data export, format version 1, in the order of its files
 * (spec S06). The product layer: it gathers each module's datasets, platform today; the food
 * modules add theirs from S07 on (rule 20).
 */
export const exportDatasets: readonly ExportDataset[] = [
  restaurantDataset,
  branchesDataset,
  branchHoursDataset,
  branchHourExceptionsDataset,
  branchChargesDataset,
  staffDataset,
  devicesDataset,
  auditLogDataset,
  agreementTermsDataset,
  entitlementsDataset,
  syncAttentionDataset,
];
