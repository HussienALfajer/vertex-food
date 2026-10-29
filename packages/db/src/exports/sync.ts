import { asc, eq, gt } from 'drizzle-orm';
import { attentionItems, attentionResolutions } from '../schema/sync.js';
import { branches } from '../schema/tenancy.js';
import { byPages, EXPORT_PAGE_SIZE, type ExportDataset } from './dataset.js';

// The items that needed a person (module `sync`, spec S04 rule 47), each with its resolution.
// The commands themselves are sync mechanics, left out; their records arrive with their own
// datasets (orders from S09).

export const syncAttentionDataset: ExportDataset = {
  stem: 'sync_attention',
  tables: ['attention_items', 'attention_resolutions'],
  reads: ['branches'],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'branch_id', kind: 'text' },
    { name: 'branch_code', kind: 'text' },
    { name: 'command_id', kind: 'text' },
    { name: 'kind', kind: 'text' },
    { name: 'membership_id', kind: 'text' },
    { name: 'created_at', kind: 'instant' },
    { name: 'resolved_at', kind: 'instant' },
    { name: 'resolved_by_membership_id', kind: 'text' },
    { name: 'resolution_reason', kind: 'text' },
  ],
  async *rows(tx) {
    const pages = byPages((after) =>
      tx
        .select({
          id: attentionItems.id,
          item: attentionItems,
          branchCode: branches.code,
          resolution: attentionResolutions,
        })
        .from(attentionItems)
        .innerJoin(branches, eq(branches.id, attentionItems.branchId))
        .leftJoin(attentionResolutions, eq(attentionResolutions.itemId, attentionItems.id))
        .where(after === null ? undefined : gt(attentionItems.id, after))
        .orderBy(asc(attentionItems.id))
        .limit(EXPORT_PAGE_SIZE),
    );
    for await (const { item, branchCode, resolution } of pages) {
      yield {
        id: item.id,
        branch_id: item.branchId,
        branch_code: branchCode,
        command_id: item.commandId,
        kind: item.kind,
        membership_id: item.membershipId,
        created_at: item.createdAt,
        resolved_at: resolution?.resolvedAt ?? null,
        resolved_by_membership_id: resolution?.resolvedByMembershipId ?? null,
        resolution_reason: resolution?.reason ?? null,
      };
    }
  },
};
