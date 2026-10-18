# Glossary

One name per concept. Code, contracts and tables use the English term; the Arabic term is what users see. Add a row when a spec introduces a new concept.

| Arabic (UI) | English (code) | Meaning |
|---|---|---|
| المنصة | platform | Vertex Food as a whole |
| العميل / المطعم | tenant | The contracting restaurant or chain |
| الفرع | branch | A place of a tenant that cooks and sells |
| حالة المطعم | tenant status | `onboarding` (قيد الإعداد), `active` (نشط), `suspended` (معلّق), `closed` (مغلق) |
| الموظف | staff member | A person with a role in a tenant |
| الصلاحية | permission | A right granted through a role |
| الجهاز | device | A registered restaurant PC or tablet |
| المركز المحلي | hub | The restaurant app that serves the branch's kitchen display and waiter app over the LAN |
| المركز الاحتياطي | standby | A second restaurant PC that holds a live copy of the hub's journal and takes over when the hub stops (ADR 0022) |
| سجل المركز | hub journal | The hub's ordered list of the branch's commands, copied to the standby (ADR 0022) |
| الدورة | epoch | The hub's term number; the higher epoch is the hub after a takeover or a split (ADR 0022) |
| رمز PIN | PIN | A staff member's short code on a registered device |
| المنيو | menu | A branch's categories and items |
| الصنف | menu item | Something sold, with sizes and modifiers |
| الحجم / النوع | variant | A size or kind of an item with its own price |
| الإضافات | modifier group / modifier | A group of options added to an item (required or optional, min and max) |
| نفد | sold out | An item unavailable for now |
| الطلب | order | One customer's order, whatever the channel |
| قناة الطلب | channel | `pos`, `waiter`, `phone`, `qr`, `restaurant_web`, `marketplace` |
| نوع الطلب | order type | `dine_in` (صالة), `takeaway` (سفري), `delivery` (توصيل), `pickup` (استلام) |
| بند الطلب | order line | An item in an order with its modifiers, notes and price snapshot |
| حدث الطلب | order event | An append-only record of a change to an order |
| الطاولة | table | A dine-in table of a branch |
| قسم المطبخ | kitchen station | A part of the kitchen that prepares some items |
| شاشة المطبخ | kitchen display (KDS) | The screen that shows a station's tickets |
| تذكرة المطبخ | kitchen ticket | What a station receives for an order |
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
| موقع متأخر | stale position | An on-duty driver with no new location for 3 minutes: the app was killed or the phone has no signal (ADR 0024) |
| العهدة النقدية | cash on hand | Cash a driver holds and on whose behalf |
| التسليم | handover | A driver giving collected cash to the restaurant or Vertex |
| الإسناد اليدوي | dispatch | Assigning a delivery job to a driver |
| الكتالوج | catalog | All features and limits Vertex sells |
| الباقة | package | A preset of catalog items for agreements |
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
| الوكيل | field agent | A Vertex seller who signs restaurants |
| وصول الدعم | support access | Vertex staff opening a tenant's data with its permission |
