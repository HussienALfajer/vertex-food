/**
 * The hub client pages a branch PC serves to phones and screens on the LAN (spec S04 screens 6–9):
 * installing the branch certificate, pairing, PIN sign-in and the network check. PR 7 of S04 adds
 * the page texts; S11 and S12 add the kitchen display's and the waiter app's.
 */
export const hubClients = {
  title: 'شاشات الفرع',
  // The page the hub serves until PR 7's pages replace it.
  placeholder: {
    heading: 'حاسوب الفرع يعمل',
    body: 'هذه الصفحة يقدّمها حاسوب الفرع على شبكة المطعم المحلية.',
  },
} as const;
