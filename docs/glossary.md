# Glossary

One name per concept. Code, contracts and tables use the English term; the Arabic term is what users see. Add a row when a spec introduces a new concept.

| Arabic (UI) | English (code) | Meaning |
|---|---|---|
| المنصة | platform | Vertex Food as a whole |
| العميل / المطعم | tenant | The contracting restaurant or chain |
| الفرع | branch | A place of a tenant that cooks and sells |
| حالة المطعم | tenant status | `onboarding` (قيد الإعداد), `active` (نشط), `suspended` (معلّق), `closed` (مغلق) |
| الاسم المختصر | slug | A tenant's Latin name in its web address `<slug>.<platform domain>`; old slugs stay aliases forever |
| رمز الفرع | branch code | A branch's short Latin code, fixed at creation, used in QR links |
| معالج الإعداد | onboarding wizard | The owner's steps that complete a new tenant before Vertex activates it |
| وضع التدريب | training mode | POS work while a tenant is onboarding: orders left out of reports, the ledger and number ranges |
| ساعات العمل | working hours | A branch's weekly opening periods, deciding when online orders are accepted |
| استثناء الدوام | hours exception | A dated change to a branch's hours: closed, or special periods |
| يوم العمل | business day | A branch's trading day, ending at its business day end (default 04:00), not at midnight |
| بند الرسوم | charge line | A branch's tax or service charge: a rate, inclusive or added, for chosen order types |
| المحافظة | governorate | A Syrian governorate in the platform list (for example Aleppo) |
| المدينة | city | A city of a governorate in the platform list (for example Azaz) |
| الموظف | staff member | A person with a role in a tenant |
| الصلاحية | permission | A right granted through a role |
| الجهاز | device | A registered restaurant PC or tablet |
| المركز المحلي | hub | The restaurant app that serves the branch's kitchen display and waiter app over the LAN |
| المركز الاحتياطي | standby | A second restaurant PC that holds a live copy of the hub's journal and takes over when the hub stops (ADR 0022) |
| سجل المركز | hub journal | The hub's ordered list of the branch's commands, copied to the standby (ADR 0022) |
| الدورة | epoch | The hub's term number; the higher epoch is the hub after a takeover or a split (ADR 0022) |
| رمز PIN | PIN | A staff member's six-digit code, valid on every registered PC of their branches, offline too (ADR 0032) |
| العضوية | staff membership | A person's place in a tenant: roles, branch scope, permission adjustments, status |
| الدور | role | A preset of permissions: owner, manager, cashier, waiter, kitchen, driver |
| قائمة الموظفين على الجهاز | member list | The branch's members, permissions and PIN verifiers held by each registered PC |
| مهلة الانقطاع | offline window | 7 days after a PC's last member-list refresh; after it only members who used that PC sign in, with a warning |
| موافقة المدير | manager approval | A member holding a permission approves another's action with their PIN on the same device |
| إعادة التحقق | re-authentication | Entering the password (staff) or a TOTP code (console) again before a sensitive action |
| جهاز شخصي | personal device | An owner's or manager's own browser or app, signed in for the back office, online only |
| المحطة | station | A paired hub client without personal sign-in, such as the kitchen display (not a kitchen station, below) |
| الحجر | quarantine | Commands from a revoked device held until the owner accepts or rejects them |
| الأمر | command | A typed, signed change made on a restaurant PC or hub client, run by the hub and re-executed by the server once per id (ADR 0008, 0035) |
| سجل الأوامر | command log | The server's append-only record of each command's first execution and its outcome: accepted, adjusted or rejected |
| حاسوب المركز | hub-capable PC | One of the two PCs of a branch configured as hub or standby (ADR 0035) |
| حاسوب عميل | client PC | A third or later PC of a branch: it sends its commands to the active hub and is never a hub |
| الإقران | pairing | A phone or screen trusted by the branch's hub PCs after a manager opened pairing and the code was typed; a station or a personal (shared) phone |
| شهادة الفرع | branch CA | The branch's certificate authority, issued by the platform, that every hub PC's certificate and every paired browser trust |
| كتلة الأرقام | number block | A span of order numbers (1–4999, 5001–9999, …) the server gives one hub PC for one business day |
| رقم مؤقت | provisional label | An order's label from its id when its PC has no number left; the server numbers it on sync |
| قائمة الإرسال | outbox | A client's commands not yet answered, re-sent with the same id until the hub answers; shown as "sending" |
| يحتاج انتباهًا | needs attention | Commands the server adjusted, rejected or flagged, listed until an owner or manager closes them with a reason |
| حالة الاتصال | connectivity state | A branch's `online`, `weak` or `offline` state from its PCs' heartbeats (ADR 0030, 0035) |
| الوقت الفعلي للأمر | effective time | A command's device time corrected by its PC's measured clock offset |
| فحص شبكة الفرع | network check | Test commands sent through the hub and the standby to the server, with their times |
| مستخدم المنصة | platform user | A Vertex staff account in the console, with a role and mandatory TOTP |
| الحساب | account | One person on the platform: phone, name, password; holds staff memberships in tenants (ADR 0005, 0032) |
| رمز التحقق | OTP | A one-time code sent to a phone sent by WhatsApp from a platform number (S03), with expiry, attempts, cooldown and an hourly limit; for console users, the TOTP code of their authenticator app |
| رقم المنصة | platform number | A WhatsApp number owned by Vertex, linked to the gateway, that sends OTPs and transactional messages (ADR 0034) |
| بوابة واتساب | WhatsApp gateway | `apps/whatsapp-gateway`: runs the platform numbers and sends the send queue |
| طابور الإرسال | send queue | `whatsapp_messages`: every outgoing WhatsApp message, claimed by the gateway |
| قالب الرسالة | message template | A fixed message text with named parameters, in code (`packages/contracts`, `packages/i18n`) |
| إشعار | notification | A transactional message about something the person started (an order, a link to confirm); never marketing |
| فترة الإحماء | warm-up | A new platform number's first weeks, when its daily cap grows with its age |
| أول تواصل | first contact | A message from a platform number to a phone it never messaged before; capped at half the daily cap |
| إيقاف الرسائل | opt-out | «إيقاف» to a platform number stops every message but requested OTPs; «تشغيل» restores them |
| رد آلي | auto-reply | The once-a-day answer to a known recipient's message: incoming messages are not read |
| إثبات العمل | proof of work | A small computation the client solves before sign-in and OTP requests, against abuse (ADR 0016) |
| التذكرة | ticket | A short-lived, single-use token proving a passed sign-in step (OTP verified, password set); never a kitchen ticket |
| رمز الإعداد | setup code | The one-time code a console admin hands a new or reset platform user for their first sign-in |
| رموز الاسترداد | recovery codes | Ten single-use codes a platform user keeps for when their authenticator app is lost |
| القفل التلقائي | idle lock | The lock screen a PC shows after a branch's idle minutes (1 to 60, default 5) |
| حذف بيانات الجهاز | wipe | A revoked PC deleting its key and member list at its next connection |
| المنيو | menu | A branch's categories and items |
| الصنف | menu item | Something sold, with sizes and modifiers |
| عنصر البيع | catalog item | The platform's generic name for something a tenant sells; in the food domain, a menu item (ADR 0025) |
| السعر الأساسي | base price | An item's price in USD, from which its SYP and TRY prices are derived (ADR 0031) |
| قاعدة التقريب | rounding rule | A branch's step and direction for rounding a derived price in one currency |
| تكلفة الصنف | item cost | The cost of an item entered by hand, seen and edited by the owner only, for menu engineering |
| نفس سعر المحل | same price as in-store | A badge shown when every item's app price equals its dine-in price, for branches running the POS (ADR 0029) |
| طلب ضائع | lost demand | A tap on a sold-out item, recorded without the customer's identity |
| الحجم / النوع | variant | A size or kind of an item with its own price |
| الإضافات | modifier group / modifier | A group of options added to an item (required or optional, min and max) |
| نفد | sold out | An item unavailable for now |
| الطلب | order | One customer's order, whatever the channel |
| قناة الطلب | channel | `pos`, `waiter`, `phone`, `qr`, `restaurant_web`, `marketplace` (the planned values; the contracts get them with S09) |
| نوع الطلب | order type | `dine_in` (صالة), `takeaway` (سفري), `delivery` (توصيل), `pickup` (استلام); in the platform layer the **sales channel** (`salesChannelSchema`) a branch's charges apply to (ADR 0025) |
| وضع استقبال الطلبات | order-intake mode | A mode of the restaurant app, online only, for a restaurant that keeps its own cashier system (ADR 0028) |
| الوقت الموعود | promised time | The ready or delivery time given to the customer at acceptance |
| الاستلام السريع | express pickup | An online pickup order with a pickup code and a "ready" notification, paid at pickup |
| رمز الاستلام | pickup code | A short code the customer shows to collect an express pickup order |
| طلب الطاولة | table request | A call for the waiter or for the bill from a table's QR menu |
| اتصال ضعيف | weak connection | A branch's connectivity state between online and offline, shown to customers before ordering (ADR 0030) |
| تعديل الطلب | order adjustment | A discount, charge, tax, service or fee on an order, with its kind, source and funding |
| جهة التمويل | funding source | Who pays a discount: `restaurant`, `vertex` or `co_funded` with each party's share |
| بند الطلب | order line | An item in an order with its modifiers, notes and price snapshot |
| حدث الطلب | order event | An append-only record of a change to an order |
| الطاولة | table | A dine-in table of a branch |
| قسم المطبخ | kitchen station | A part of the kitchen that prepares some items (not a hub station, above) |
| شاشة المطبخ | kitchen display (KDS) | The screen that shows a kitchen station's tickets |
| تذكرة المطبخ | kitchen ticket | What a kitchen station receives for an order |
| الفاتورة / الإيصال | receipt | The printed or shown bill for the customer |
| الطابعة | printer | A thermal ESC/POS printer of a branch: network or USB, with a paper width and an optional cash drawer |
| طابور الطباعة | print queue | The jobs waiting for one printer, kept until printed |
| نسخة معادة | reprint | A receipt or ticket printed again because the first copy may have printed; marked on the paper |
| الدفعة | payment | Money received, append-only |
| الاسترجاع | refund | Money returned, a new row |
| الإلغاء | void | Removing a line or order before payment, with a reason |
| الوردية / جلسة الصندوق | cash session | A cashier's drawer from opening to closing count |
| سعر الصرف | exchange rate | A branch's rate between two currencies with its effective time |
| منطقة التوصيل | delivery zone | An area a branch delivers to, with a fee, a minimum and a time |
| الزبون | customer | A person who orders through the platform |
| دفتر زبائن المطعم | customer book | A restaurant's own customers (phone orders, walk-ins) |
| العنوان | address | Pin, area, landmark, description, building, floor |
| المنطقة | area | A city or area from the platform list |
| الإسناد | attribution | Where an order and its customer came from |
| السائق | driver | A person who delivers |
| أسطول المطعم | restaurant fleet | Drivers of one restaurant |
| أسطول فيرتكس | Vertex fleet | Drivers managed by Vertex |
| مهمة التوصيل | delivery job | The delivery of one order by one driver |
| في الدوام | on duty | A driver available for jobs and sharing location |
| موقع متأخر | stale position | An on-duty driver whose next location is overdue for its sampling profile (5 minutes without a job, 2 with one): the app was killed or the phone has no signal (ADR 0024) |
| العهدة النقدية | cash on hand | Cash a driver holds and on whose behalf |
| التسليم | handover | A driver giving collected cash to the restaurant or Vertex |
| الإسناد اليدوي | dispatch | Assigning a delivery job to a driver |
| كتالوج الميزات | feature catalog | All features and limits Vertex sells (ADR 0013; named so by ADR 0025) |
| الباقة | package | A preset of feature catalog entries for agreements |
| الاتفاقية | agreement | The commercial terms between Vertex and a tenant |
| البند التجاري | agreement term | One effective-dated term: subscription, commission, listing fee, waiver… |
| الإعفاء | waiver | A free period on a term |
| الاستحقاق | entitlement | What a tenant may use, derived from its agreement and overrides |
| الاستثناء | override | A manual grant, limit or trial with a reason and expiry |
| الميزة الخاصة | private feature | A catalog feature granted to one tenant |
| تعديل الاتفاقية | amendment | A set of term additions and endings, drafted by sales and approved by someone else; the only way an agreement changes (ADR 0036) |
| الحدّ | limit | A catalog entry counting something a tenant may add (branches, PCs, staff, catalog items, custom field definitions) |
| القيمة المرجعية | list value | A template's value for a term; a different value carries a reason |
| مهلة الاستحقاقات | entitlement lease | The 7 days a PC trusts its copy of its branch's entitlements after its last sync |
| استخدام خارج الاستحقاق | entitlement exception | A command the server accepted although its feature was off at its time, recorded for Vertex |
| فرع فعّال | active branch | A non-archived branch, counted per day for terms charged per branch |
| الدفتر المالي | ledger | Append-only double-entry records between restaurants, drivers and Vertex |
| كشف الحساب | statement | A restaurant's monthly charges, commissions, collections and balance |
| الهوية البصرية | branding | A tenant's logo, cover, accent color and font |
| الحقل المخصص | custom field | A bounded field a tenant adds to items or orders |
| الظهور في التطبيق | listing | A branch shown in the customer app |
| التقييم | rating | A customer's 1–5 score for one order |
| الحملة | campaign | An offer or a coupon with its rules, budget, validity and funding, changed by new versions (ADR 0026) |
| العرض | offer | A campaign applied automatically when its conditions hold |
| القسيمة / الكوبون | coupon | A campaign applied with a code |
| حملة المنصة | platform campaign | A campaign Vertex runs from the console; a restaurant can opt out of them |
| عرض مشترك التمويل | co-funded offer | A campaign whose cost is shared between Vertex and a restaurant that accepted its share |
| محفظة الخصومات | discount wallet | The coupons, rewards and point balances a customer can use |
| برنامج الولاء | loyalty program | A restaurant's points or stamp card, or Vertex's platform points |
| النقاط | points | Loyalty units, append-only entries, a liability with an expiry |
| بطاقة الأختام | stamp card | A reward after a number of qualifying orders |
| متجر المكافآت | rewards store | Where a customer spends platform points on Vertex-funded rewards |
| الإحالة | referral | A customer's code that rewards them and a new customer after the new customer's first completed order |
| ربط هوية الزبون | customer link | A POS customer joined to their platform account after confirming by WhatsApp, with consent (F48) |
| سياسة الثقة | trust policy | Vertex's versioned rules for the late guarantee, no-shows and reliability (ADR 0027) |
| ضمان التأخير | late guarantee | Compensation for an order later than its promised time, paid by the party at fault |
| عدم الحضور | no-show | A delivery not received or a pickup not collected, with the policy's evidence |
| دين الزبون | customer debt | A no-show penalty carried by the customer's next order; the account is suspended until it is paid |
| مستوى الموثوقية | reliability level | The level of a customer's platform reliability score, the only part restaurants see |
| هندسة المنيو | menu engineering | Classifying items by sales and margin from the item cost |
| الإيراد الضائع | lost revenue | Sales missed through rejections, cancellations, auto-rejections and sold-out taps |
| نهائي بعد المزامنة | final after sync | A figure that may still change until every device of the branch has synced, shown with its last update time |
| الوكيل | field agent | A Vertex seller who signs restaurants |
| وصول الدعم | support access | Vertex staff opening a tenant's data with its permission |
| سجل العمليات | audit log | The append-only record of changes in a tenant (`audit_entries`), read by the owner; the platform's own is «سجل المنصة» (`platform_audit_entries`) |
| فئة العملية | audit category | The group of an audit action shown as a filter: access, devices, settings, agreement, data, money, menu and prices, support |
| تصدير البيانات | data export | A complete copy of a tenant's data as a ZIP of CSV files from one snapshot, kept 7 days |
| مجموعة بيانات | export dataset | One CSV file of an export, declared by the module whose tables it reads |
| رابط التنزيل | download link | A 10-minute link to an export's file that resumes a broken download |
