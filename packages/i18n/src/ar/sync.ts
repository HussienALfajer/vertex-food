import type {
  AttentionKind,
  CommandOutcome,
  CommandReason,
  ConnectivityState,
  LiveRole,
  QuarantineReason,
} from '@vertex-food/contracts';

/**
 * Sync and the branch hub on the restaurant PCs (spec S04): the outcome and reason of every
 * command, the needs-attention kinds, roles and connectivity, and the summaries each command's
 * `describe` names (`commands.<name>`). The screens of PR 6 add their texts here.
 */
export const sync = {
  outcomes: {
    accepted: 'مقبول',
    adjusted: 'معدَّل',
    rejected: 'مرفوض',
  },
  reasons: {
    payload_invalid: 'بيانات الأمر غير صالحة.',
    permission_missing: 'لا يملك العضو صلاحية هذا الأمر.',
    pin_session_ended: 'انتهت جلسة الرمز السري. سجّل الدخول من جديد.',
    station_not_allowed: 'لا تستطيع هذه الشاشة تنفيذ هذا الأمر.',
    unknown_command: 'أمر غير معروف لهذه النسخة.',
    version_unsupported: 'نسخة الأمر غير مدعومة. حدّث التطبيق.',
    protocol_unsupported: 'نسخة المزامنة غير مدعومة. حدّث التطبيق.',
    signature_invalid: 'تعذّر التحقق من توقيع الحاسوب الذي نفّذ الأمر.',
    device_revoked: 'نُفّذ الأمر على حاسوب أُزيل من المطعم.',
    member_inactive: 'أُوقف العضو أو خرج من الفرع قبل وصول الأمر.',
    approver_not_allowed: 'لا يملك الموافِق صلاحية هذا الأمر.',
    number_out_of_block: 'الرقم خارج نطاق أرقام الحاسوب في ذلك اليوم.',
    server_error: 'خطأ في الخادم أثناء التنفيذ. سيُعاد تنفيذه بعد الإصلاح.',
  },
  attentionKinds: {
    adjusted: 'عدّله الخادم',
    rejected: 'رفضه الخادم',
    replay_mismatch: 'وصل بنسختين مختلفتين',
    number_taken: 'الرقم مستخدم من قبل',
    clock_suspect: 'ساعة الحاسوب غير دقيقة',
    server_error: 'خطأ في الخادم',
  },
  quarantineReasons: {
    device_revoked: 'حاسوب أُزيل من المطعم',
    member_inactive: 'عضو أُوقف أثناء انقطاع الإنترنت',
  },
  liveRoles: {
    hub: 'المركز',
    standby: 'الاحتياطي',
    client: 'حاسوب عميل',
    rejoining: 'يعيد الانضمام',
  },
  connectivity: {
    online: 'متصل',
    weak: 'اتصال ضعيف',
    offline: 'غير متصل',
  },
  /** `commands.<module>.<action>`, the key a command's `describe` returns. */
  commands: {
    sync: { network_check: 'اختبار الشبكة رقم {{sequence}}' },
    audit: { record_local_events: 'رفع {{count}} من الأحداث المسجلة دون اتصال' },
  },
} as const satisfies {
  outcomes: Record<CommandOutcome, string>;
  reasons: Record<CommandReason, string>;
  attentionKinds: Record<AttentionKind, string>;
  quarantineReasons: Record<QuarantineReason, string>;
  liveRoles: Record<LiveRole, string>;
  connectivity: Record<ConnectivityState, string>;
  commands: Record<string, Record<string, string>>;
};
