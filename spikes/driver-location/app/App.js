// Spike screen: duty, the current job, the queue. Arabic, right to left. Commands also arrive as deep links
// (vfdriverspike://cmd?...) so the emulator script can drive the app; a real driver taps the same buttons.
// Throwaway: no design system, no i18n catalog.
import NetInfo from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Button, I18nManager, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { bump, get, outbox, set } from './src/store';
import { onSyncChange, maybeSync } from './src/sync';
import { applyTracking, lastFix } from './src/tracking';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const FLEET = 'fleet-r1';
const NEXT = { offered: 'accepted', accepted: 'at_restaurant', at_restaurant: 'picked_up', picked_up: 'delivered' };
const LABEL = {
  offered: 'معروضة عليك',
  accepted: 'مقبولة',
  at_restaurant: 'في المطعم',
  picked_up: 'استُلمت',
  delivered: 'سُلّمت',
  failed: 'تعذّر التسليم',
  returned: 'أُعيدت',
};
const ACTIVE_AFTER = new Set(['accepted', 'at_restaurant', 'picked_up']);

async function goDuty(on) {
  outbox.record({ type: on ? 'duty_on' : 'duty_off', fleet: FLEET });
  set('onDuty', on);
  if (!on) set('activeJob', false);
  const t = await applyTracking();
  set('tracking', t);
  await maybeSync('event');
}

async function jobEvent(jobId, type) {
  outbox.record({ type, jobId }, lastFix());
  set('activeJob', ACTIVE_AFTER.has(type));
  set('tracking', await applyTracking());
  await maybeSync('event');
}

async function handleUrl(url) {
  if (!url?.startsWith('vfdriverspike://cmd')) return;
  const p = new URL(url.replace('vfdriverspike://', 'http://x/')).searchParams;
  if (p.get('server')) set('server', p.get('server'));
  if (p.get('token')) set('token', p.get('token'));
  const action = p.get('do');
  if (action === 'duty_on') await goDuty(true);
  if (action === 'duty_off') await goDuty(false);
  if (action === 'event') await jobEvent(p.get('job'), p.get('type'));
}

function getJobs(server, token) {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('GET', `${server}/driver/jobs`);
    x.timeout = 10_000;
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.onload = () => resolve(x.status === 200 ? JSON.parse(x.responseText) : null);
    x.onerror = x.ontimeout = () => resolve(null);
    x.send();
  });
}

export default function App() {
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const [jobs, setJobs] = useState(null);
  const [server, setServer] = useState(get('server', 'http://10.0.2.2:8788'));
  const [token, setToken] = useState(get('token', 'tok-d1'));

  useEffect(() => {
    const off = onSyncChange(refresh);
    Linking.getInitialURL().then((u) => handleUrl(u).then(refresh));
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url).then(refresh));
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) maybeSync('online');
    });
    // Resume after the app was killed: duty is kept on the phone, tracking restarts when the driver opens it.
    if (get('onDuty', false)) applyTracking().then((t) => set('tracking', t));
    // Counts how often a JavaScript timer fires; compared in the background with the task's calls.
    const timer = setInterval(() => {
      bump('timerTicks');
      maybeSync('timer');
      refresh();
    }, 5_000);
    return () => {
      off();
      sub.remove();
      net();
      clearInterval(timer);
    };
  }, [refresh]);

  const load = async () => setJobs(await getJobs(get('server'), get('token')));
  const onDuty = get('onDuty', false);
  const counts = outbox.counts();
  const last = get('lastSync');
  const job = jobs?.active?.[0];

  return (
    <ScrollView contentContainerStyle={s.page}>
      <StatusBar style="dark" />
      <Text style={s.h1}>فيرتكس فود — السائق (تجربة)</Text>
      <View style={s.card}>
        <Text style={s.big}>{onDuty ? 'في الخدمة' : 'خارج الخدمة'}</Text>
        <Text style={s.muted}>{onDuty ? 'يُشارك موقعك أثناء الخدمة فقط' : 'لا يُسجَّل موقعك'}</Text>
        <Button title={onDuty ? 'إنهاء الخدمة' : 'بدء الخدمة'} onPress={() => goDuty(!onDuty).then(refresh)} />
      </View>
      <View style={s.card}>
        <Text style={s.h2}>الطلب الحالي</Text>
        {job ? (
          <>
            <Text>الحالة: {LABEL[job.state]}</Text>
            <Text>الزبون: {job.customer.name}</Text>
            <Text>الهاتف: {job.customer.phone}</Text>
            <Text>العنوان: {job.customer.address}</Text>
            {NEXT[job.state] ? <Button title={`تسجيل: ${LABEL[NEXT[job.state]]}`} onPress={() => jobEvent(job.id, NEXT[job.state]).then(load)} /> : null}
          </>
        ) : (
          <Text style={s.muted}>لا طلب نشط</Text>
        )}
        <Button title="تحديث الطلبات" onPress={load} />
      </View>
      <View style={s.card}>
        <Text style={s.h2}>قائمة الإرسال</Text>
        <Text>
          أحداث بانتظار الإرسال: {counts.events} · نقاط: {counts.points}
        </Text>
        <Text style={s.muted}>{last ? (last.error ? `فشل آخر إرسال (${last.failures})` : 'آخر إرسال ناجح') : 'لم يُرسل شيء بعد'}</Text>
        {outbox.outcomes().map((o) => (
          <Text key={o.id} style={s.warn}>
            حدث لم يُطبَّق: {o.reason}
          </Text>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.h2}>إعدادات التجربة</Text>
        <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" />
        <TextInput style={s.input} value={token} onChangeText={setToken} autoCapitalize="none" />
        <Button
          title="حفظ"
          onPress={() => {
            set('server', server);
            set('token', token);
            refresh();
          }}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12, backgroundColor: '#f6f6f4', flexGrow: 1 },
  h1: { fontSize: 20, fontWeight: '700', textAlign: 'left' },
  h2: { fontSize: 16, fontWeight: '700', textAlign: 'left' },
  big: { fontSize: 22, fontWeight: '700', textAlign: 'left' },
  muted: { color: '#666', textAlign: 'left' },
  warn: { color: '#a40000', textAlign: 'left' },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 12, gap: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, textAlign: 'left' },
});
