import type { ErrorCode } from '@vertex-food/contracts';

/** The Arabic text of every error code front ends show (ADR 0020); the server's message is for logs. */
export const errors = {
  VALIDATION_FAILED: 'بعض البيانات غير صحيحة. راجعها ثم أعد المحاولة.',
  UNAUTHENTICATED: 'انتهت الجلسة. سجّل الدخول من جديد.',
  FORBIDDEN: 'ليست لديك صلاحية لهذه العملية.',
  NOT_ENTITLED: 'هذه الميزة غير مشمولة في اتفاقية المطعم.',
  TENANT_SUSPENDED: 'حساب المطعم موقوف. تواصل مع فيرتكس فود.',
  NOT_FOUND: 'العنصر المطلوب غير موجود.',
  CONFLICT: 'تعارضت هذه العملية مع تغيير آخر. حدّث البيانات ثم أعد المحاولة.',
  CURRENCY_MISMATCH: 'لا يمكن الجمع بين مبالغ بعملات مختلفة.',
  INVALID_AMOUNT: 'المبلغ غير صالح.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  INTERNAL_ERROR: 'حدث خطأ في الخادم. أعد المحاولة لاحقًا.',
  TENANT_CLOSED: 'حساب المطعم مغلق.',
  ONBOARDING_INCOMPLETE: 'إعداد المطعم غير مكتمل. أكمل البنود الناقصة ثم أعد المحاولة.',
  INVALID_STATUS_TRANSITION: 'لا يمكن تغيير حالة المطعم بهذه الطريقة.',
  LAST_ACTIVE_BRANCH: 'لا يمكن أرشفة الفرع الوحيد للمطعم.',
  FILE_REJECTED: 'تعذّر قبول الصورة. استخدم صورة PNG أو JPEG أو WebP ضمن الحجم المسموح.',
  MAP_LINK_UNRECOGNIZED:
    'لم نتعرّف على رابط الخريطة. الصق رابطًا من خرائط Google أو OpenStreetMap، أو الإحداثيات مباشرة.',
  SLUG_TAKEN: 'هذا المعرّف مستخدم من قبل.',
  SLUG_RESERVED: 'هذا المعرّف محجوز أو غير صالح.',
  BRANCH_CURRENCY_LOCKED: 'لا يمكن تغيير العملة الأساسية بعد تسجيل أول طلب.',
  INVALID_HOURS: 'أوقات العمل غير صحيحة: تحقّق من التداخل ومن نهاية يوم العمل.',
  SERVICE_UNAVAILABLE: 'الخدمة غير متاحة الآن. أعد المحاولة بعد قليل.',
} satisfies Record<ErrorCode, string>;
