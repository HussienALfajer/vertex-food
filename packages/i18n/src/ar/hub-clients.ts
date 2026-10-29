/**
 * The hub client pages a branch PC serves to phones and screens on the LAN (spec S04 screens 6–9):
 * installing the branch certificate, pairing, PIN sign-in and the network check. S11 and S12 add
 * the kitchen display's and the waiter app's.
 */
export const hubClients = {
  title: 'شاشات الفرع',
  loading: 'جارٍ التحميل…',
  back: 'رجوع',
  connection: {
    connected: 'متصل بحاسوب الفرع',
    reconnecting: 'جارٍ إعادة الاتصال بحاسوب الفرع…',
    reconnectingHint:
      'لا يجيب أي حاسوب من حاسوبَي الفرع الآن. تبقى الأوامر هنا وتُرسل حين يعود الاتصال.',
    hub: 'الحاسوب المركزي {{address}} · الدورة {{epoch}}',
    standby: {
      in_sync: 'الاحتياطي متزامن',
      not_in_sync: 'الاحتياطي غير متزامن',
      none: 'لا يوجد حاسوب احتياطي',
    },
    internet: 'الإنترنت في الفرع: {{state}}',
  },
  install: {
    heading: 'ثبّت شهادة الفرع',
    description:
      'يتصل هذا الهاتف بحاسوب الفرع اتصالًا مشفّرًا. ثبّت شهادة الفرع مرة واحدة قبل الإقران.',
    steps: {
      open: 'على الحاسوب المركزي، يفتح المدير الإقران من شاشة «شبكة الفرع».',
      download: 'امسح رمز الشهادة الظاهر على الحاسوب، أو اضغط «تنزيل الشهادة» أدناه.',
      install:
        'في الإعدادات: الأمان والخصوصية ← إعدادات أمان أخرى ← التشفير وبيانات الاعتماد ← تثبيت شهادة ← شهادة CA، ثم اختر الملف المنزَّل.',
      compare: 'قارن بصمة الشهادة في تفاصيلها ببصمة الحاسوب، ولا تتابع إن اختلفت.',
      pair: 'امسح رمز الإقران الظاهر على الحاسوب، أو اكتب رمز الإقران.',
    },
    qrLabel: 'رمز تنزيل شهادة الفرع',
    download: 'تنزيل الشهادة',
    downloadHint: 'التنزيل متاح فقط ما دام الإقران مفتوحًا على الحاسوب المركزي.',
    fingerprint: 'بصمة الشهادة',
    fingerprintOnPc: 'تظهر البصمة على شاشة الحاسوب المركزي بجانب رمز الشهادة.',
    next: 'ثبّتُّ الشهادة: إقران الهاتف',
  },
  pair: {
    heading: 'إقران الهاتف',
    description: 'اكتب الرمز المكوّن من 6 أرقام الظاهر على الحاسوب المركزي.',
    code: 'رمز الإقران',
    codeInvalid: 'اكتب 6 أرقام.',
    submit: 'إقران',
    pairing: 'جارٍ الإقران…',
    lockedFor: 'محاولات خاطئة كثيرة. أعد المحاولة بعد {{seconds}} ثانية.',
    unreachable: 'تعذّر الوصول إلى حاسوب الفرع. تأكد أن الهاتف على شبكة المطعم.',
    fingerprintMismatch:
      'بصمة الشهادة لا تطابق رمز الإقران. لم يُقرن الهاتف. اطلب من المدير فتح الإقران من جديد.',
    ended: 'انتهى إقران هذا الهاتف أو أُلغي. أقرنه من جديد.',
    install: 'كيف أثبّت الشهادة؟',
  },
  station: {
    heading: 'شاشة مقترنة',
    description: 'هذه الشاشة مقترنة بالفرع. تضيف المواصفات التالية شاشة المطبخ إليها.',
  },
  signIn: {
    heading: 'من يستخدم الهاتف؟',
    description: 'اختر اسمك ثم اكتب رمزك السري.',
    members: 'أعضاء الفريق',
    empty: 'لا يوجد أعضاء على حاسوب الفرع بعد.',
    error: 'تعذّر تحميل أعضاء الفريق. أعد المحاولة.',
    retry: 'إعادة المحاولة',
    pinFor: 'الرمز السري لـ{{name}}',
    entered: 'أُدخل {{count}} من 6 أرقام',
    delete: 'حذف رقم',
    otherMember: 'عضو آخر',
  },
  roles: {
    owner: 'مالك',
    manager: 'مدير',
    cashier: 'كاشير',
    waiter: 'نادل',
    kitchen: 'مطبخ',
    driver: 'سائق',
  },
  session: {
    signedInAs: 'مسجّل باسم {{name}}',
    signOut: 'تسجيل الخروج',
    ended: 'انتهت الجلسة. سجّل الدخول من جديد.',
  },
  home: {
    heading: 'الهاتف جاهز',
    description: 'لا يوجد ما تفعله هنا بعد. تضيف المواصفات التالية تطبيق النادل.',
    check: 'اختبار الشبكة',
  },
  check: {
    heading: 'اختبار الشبكة',
    description: 'يرسل أوامر اختبار عبر الحاسوب المركزي والاحتياطي كما ستُرسل الطلبات.',
    noPermission: 'اختبار الشبكة لمن يملك صلاحية إدارة شبكة الفرع.',
    sending: 'قيد الإرسال {{count}}',
    nothingSending: 'لا شيء قيد الإرسال',
    sendTest: 'إرسال اختبار',
    lastTest: 'آخر اختبار',
    roundTrip: 'ذهاب وإياب: {{ms}} م.ث',
    toHub: 'من الهاتف إلى المركز: {{ms}} م.ث',
    mirrored: 'نسخه الاحتياطي بعد {{ms}} م.ث',
    notMirrored: 'لم ينسخه الاحتياطي',
    committed: 'حُفظ بعد {{ms}} م.ث',
    waiting: 'قيد الإرسال…',
    stress: {
      heading: 'اختبار التحمّل',
      count: 'عدد الأوامر',
      countInvalid: 'من 1 إلى 10000.',
      interval: 'الفاصل بالميلي ثانية',
      intervalInvalid: 'من 0 إلى 60000.',
      start: 'بدء الاختبار',
      stop: 'إيقاف',
      progress: 'أُرسل {{sent}} من {{total}} · وصل {{acknowledged}}',
    },
    recent: 'آخر الاختبارات على الحاسوب المركزي',
    recentEmpty: 'لا اختبارات بعد.',
    recentItem: 'رقم {{sequence}}',
    refused: 'رفض الحاسوب المركزي الأمر: {{reason}}',
  },
} as const;
