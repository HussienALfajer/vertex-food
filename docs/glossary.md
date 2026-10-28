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
| مستخدم المنصة | platform user | A Vertex staff account in the console, with a role and mandatory TOTP |
| الحساب | account | One person on the platform: phone, name, password; holds staff memberships in tenants (ADR 0005, 0032) |
| رمز التحقق | OTP | A one-time code sent to a phone (fake sender until S03), with expiry, attempts, cooldown and an hourly limit; for console users, the TOTP code of their authenticator app |
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
