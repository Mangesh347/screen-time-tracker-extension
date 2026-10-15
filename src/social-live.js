/**
 * Social live sync — prefers Supabase Realtime; soft-polls when unavailable.
 * Callers soft-merge UI (no full remount flash).
 */
import { CONFIG } from './config.js';
import { log } from './logger.js';

const SOFT_POLL_MS = 3000;
const SOFT_POLL_WITH_RT_MS = 10000;

function realtimeUrl(accessToken) {
  const base = (CONFIG.supabase?.url || '').replace(/^https/i, 'wss').replace(/\/$/, '');
  if (!base) return null;
  const key = CONFIG.supabase?.anonKey || '';
  const q = new URLSearchParams({
    apikey: key,
    vsn: '1.0.0',
  });
  if (accessToken) q.set('access_token', accessToken);
  return `${base}/realtime/v1/websocket?${q}`;
}

/**
 * Minimal Phoenix Realtime v2 subscriber for postgres_changes.
 * Returns a stop() fn. Silently no-ops if WS blocked / unavailable.
 */
function subscribeRealtime({ accessToken, tables, onChange }) {
  const url = realtimeUrl(accessToken);
  if (!url || typeof WebSocket === 'undefined') return { ok: false, stop: () => {} };

  let ws;
  let heartbeat;
  let ref = 1;
  const topic = `realtime:stt-social-${Date.now()}`;
  let joined = false;

  const send = (payload) => {
    try {
      ws?.send(JSON.stringify(payload));
    } catch {}
  };

  try {
    ws = new WebSocket(url);
  } catch {
    return { ok: false, stop: () => {} };
  }

  ws.onopen = () => {
    send({
      topic: 'phoenix',
      event: 'heartbeat',
      payload: {},
      ref: String(ref++),
    });
    heartbeat = setInterval(() => {
      send({
        topic: 'phoenix',
        event: 'heartbeat',
        payload: {},
        ref: String(ref++),
      });
    }, 25000);

    send({
      topic,
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: '' },
          postgres_changes: (tables || []).map((table) => ({
            event: '*',
            schema: 'public',
            table,
          })),
        },
      },
      ref: String(ref++),
    });
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
      joined = true;
      return;
    }
    if (msg.event === 'postgres_changes' || msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
      const table =
        msg.payload?.data?.table ||
        msg.payload?.table ||
        msg.payload?.meta?.table ||
        null;
      onChange?.({ source: 'realtime', table, raw: msg });
    }
  };

  ws.onerror = () => {};
  ws.onclose = () => {
    joined = false;
    if (heartbeat) clearInterval(heartbeat);
  };

  return {
    get ok() {
      return joined || (ws && ws.readyState === WebSocket.OPEN);
    },
    stop() {
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {}
      ws = null;
    },
  };
}

/**
 * @param {{ onTick: (meta: { source: string, table?: string }) => void, getAccessToken: () => Promise<string|null> }} opts
 */
export function createSocialLive(opts) {
  const { onTick, getAccessToken } = opts;
  let softTimer = null;
  let rt = null;
  let alive = false;
  let rtOk = false;
  let debounce = null;

  const SOCIAL_TABLES = [
    'stt_posts',
    'stt_friendships',
    'stt_post_likes',
    'stt_post_comments',
    'stt_post_views',
    'stt_messages',
    'stt_profiles',
  ];

  function fire(meta) {
    if (!alive || document.hidden) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        onTick(meta);
      } catch (e) {
        log.warn('[STT] social live tick', e);
      }
    }, meta.source === 'realtime' ? 180 : 0);
  }

  function startSoftPoll() {
    stopSoftPoll();
    const ms = rtOk ? SOFT_POLL_WITH_RT_MS : SOFT_POLL_MS;
    softTimer = setInterval(() => fire({ source: 'poll' }), ms);
  }

  function stopSoftPoll() {
    if (softTimer) {
      clearInterval(softTimer);
      softTimer = null;
    }
  }

  async function startRealtime() {
    rt?.stop();
    rt = null;
    rtOk = false;
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    rt = subscribeRealtime({
      accessToken: token,
      tables: SOCIAL_TABLES,
      onChange: (meta) => {
        rtOk = true;
        // Re-tune poll cadence once realtime proves live
        startSoftPoll();
        fire(meta);
      },
    });
    // Give WS a moment; if it never joins, soft poll alone covers us
    setTimeout(() => {
      if (rt?.ok) {
        rtOk = true;
        startSoftPoll();
      }
    }, 2000);
  }

  return {
    async start() {
      if (alive) return;
      alive = true;
      await startRealtime();
      startSoftPoll();
      // Immediate soft tick so badges aren't stale on open
      fire({ source: 'start' });
    },
    stop() {
      alive = false;
      stopSoftPoll();
      rt?.stop();
      rt = null;
      rtOk = false;
      clearTimeout(debounce);
    },
    get usingRealtime() {
      return rtOk;
    },
  };
}
