import type { MessageTemplateKey, WhatsAppAlertEvent } from '@vertex-food/contracts';

/**
 * The WhatsApp messages of the platform numbers (spec S03), rendered by the gateway: one text per
 * template of `messageTemplates` (`packages/contracts`), naming exactly its parameters. Fixed texts
 * until console editing (after V1); never a phone or a person's name in them.
 */
export const messaging = {
  templates: {
    otp: 'رمز التحقق في فيرتكس فود: {{code}}\nصالح لمدة 5 دقائق. لا تشاركه مع أحد، ففريق فيرتكس لا يطلبه منك أبداً.',
    alert: 'تنبيه فيرتكس فود: رقم المنصة «{{label}}» {{event}}.',
    opt_out_confirmed:
      'تم إيقاف رسائل فيرتكس فود على واتساب. ستصلك رموز التحقق فقط عندما تطلبها بنفسك. لإعادة الرسائل أرسل: تشغيل',
    opt_in_confirmed: 'تمت إعادة رسائل فيرتكس فود على واتساب. لإيقافها أرسل: إيقاف',
    auto_reply:
      'هذا رقم فيرتكس فود لإرسال رموز التحقق وتحديثات الطلبات فقط، ولا تُقرأ الرسائل الواردة إليه. للمساعدة تواصل مع المطعم أو مع الدعم من داخل التطبيق.',
  },
  /** The `event` of an alert, as the `alert` template says it. */
  alertEvents: {
    needs_relink: 'يحتاج إعادة ربط',
    banned: 'محظور من واتساب',
    disconnected: 'منقطع منذ أكثر من 5 دقائق',
    paused_send_failures: 'أُوقف تلقائياً بعد فشل الإرسال',
    none_healthy: 'لم يبقَ أي رقم يعمل، رموز التحقق متوقفة',
    healthy_again: 'عاد رقم واحد على الأقل للعمل',
  },
} as const satisfies {
  templates: Record<MessageTemplateKey, string>;
  alertEvents: Record<WhatsAppAlertEvent, string>;
};
