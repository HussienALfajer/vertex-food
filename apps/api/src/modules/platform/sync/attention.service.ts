import { Inject, Injectable } from '@nestjs/common';
import { type AttentionItem, DomainError, type ListAttentionQuery } from '@vertex-food/contracts';
import {
  attentionItems,
  attentionResolutions,
  commandLog,
  commandPayloads,
  type Database,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import type { CommandRegistry } from '@vertex-food/sync';
import { and, asc, count, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { holds, requirePermission, type StaffActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { COMMAND_REGISTRY } from './executors.js';
import { commandSummary, toAttentionItem } from './sync.views.js';

const notFound = () => new DomainError('NOT_FOUND', 'No such attention item');

/**
 * Needs attention (spec S04 rule 47): the member who made a command sees its items; members with
 * `sync.attention.resolve` in the branch see all of the branch's and close one with a reason,
 * online, audited. Items stay listed until closed.
 */
@Injectable()
export class AttentionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(COMMAND_REGISTRY) private readonly registry: CommandRegistry,
  ) {}

  list(actor: StaffActor, query: ListAttentionQuery) {
    const everyone = holds(actor, 'sync.attention.resolve', query.branchId);
    const filters: (SQL | undefined)[] = [
      eq(attentionItems.branchId, query.branchId),
      everyone ? undefined : eq(attentionItems.membershipId, actor.membershipId),
      query.kind ? eq(attentionItems.kind, query.kind) : undefined,
      query.status === 'open'
        ? isNull(attentionResolutions.id)
        : query.status === 'closed'
          ? isNotNull(attentionResolutions.id)
          : undefined,
    ];
    const where = and(...filters);
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [total] = await tx
        .select({ value: count() })
        .from(attentionItems)
        .leftJoin(attentionResolutions, eq(attentionResolutions.itemId, attentionItems.id))
        .where(where);
      const order = query.order === 'desc' ? desc : asc;
      const rows = await tx
        .select({ id: attentionItems.id })
        .from(attentionItems)
        .leftJoin(attentionResolutions, eq(attentionResolutions.itemId, attentionItems.id))
        .where(where)
        .orderBy(order(attentionItems.createdAt), order(attentionItems.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const items: AttentionItem[] = [];
      for (const row of rows) items.push(await this.read(tx, row.id));
      return { items, total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  resolve(actor: StaffActor, id: string, reason: string): Promise<AttentionItem> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [item] = await tx
        .select({ id: attentionItems.id, branchId: attentionItems.branchId })
        .from(attentionItems)
        .where(eq(attentionItems.id, id));
      if (!item || !holds(actor, 'sync.attention.resolve', item.branchId)) throw notFound();
      requirePermission(actor, 'sync.attention.resolve', item.branchId);
      await tx
        .insert(attentionResolutions)
        .values({
          tenantId: actor.tenantId,
          branchId: item.branchId,
          itemId: item.id,
          reason,
          resolvedByMembershipId: actor.membershipId,
          resolvedAt: new Date(),
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'attention_resolutions_item_unique')) {
            throw new DomainError('ATTENTION_ALREADY_RESOLVED', 'The item is already closed', {
              itemId: item.id,
            });
          }
          throw error;
        });
      await audit(tx, actor.tenantId, actor, {
        action: 'attention_item.resolved',
        entityType: 'attention_item',
        entityId: item.id,
        branchId: item.branchId,
        reason,
      });
      return this.read(tx, item.id);
    });
  }

  private async read(tx: Transaction, id: string): Promise<AttentionItem> {
    const [row] = await tx
      .select({
        item: attentionItems,
        command: commandLog,
        payload: commandPayloads.payload,
        resolved: commandPayloads.resolved,
        resolution: attentionResolutions,
      })
      .from(attentionItems)
      .innerJoin(commandLog, eq(commandLog.id, attentionItems.commandId))
      .leftJoin(commandPayloads, eq(commandPayloads.commandId, attentionItems.commandId))
      .leftJoin(attentionResolutions, eq(attentionResolutions.itemId, attentionItems.id))
      .where(eq(attentionItems.id, id));
    if (!row) throw notFound();
    const stored = row.payload ? { payload: row.payload, resolved: row.resolved } : null;
    return toAttentionItem(
      row.item,
      row.command,
      commandSummary(this.registry, row.command, stored),
      row.resolution,
    );
  }
}
