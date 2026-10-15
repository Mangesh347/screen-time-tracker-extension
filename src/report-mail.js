// Email PDF reports via Gmail API or backend
import { getAuthToken } from './auth-google.js';
import { CONFIG } from './config.js';
import { buildReportPDF, pdfToBase64, downloadPDF } from './report-pdf.js';
import { aggregateRange, fmt, calcScore } from './utils.js';
import { log } from './logger.js';

export async function prepareReportData(days = 1) {
  const { data } = await chrome.runtime.sendMessage({ type: 'GET_RANGE', days });
  const agg = aggregateRange(data || {});
  const today = Object.values(data || {})[0] || {};
  const score = days === 1 ? calcScore(today) : agg.score;
  const insights = buildInsights(agg, score);
  return {
    title: days <= 1 ? 'Daily Screen Time Report' : days <= 7 ? 'Weekly Screen Time Report' : `${days}-Day Report`,
    subtitle: days <= 1
      ? new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      : `Last ${days} days · generated ${new Date().toLocaleString()}`,
    ...agg,
    score,
    insights,
    days,
  };
}

function buildInsights(agg, score) {
  const list = [];
  const cats = Object.fromEntries((agg.catBreakdown || []).map(c => [c.category, c.time]));
  if ((cats.social || 0) > 3600) list.push({ title: 'Social Media Overuse', desc: `${fmt(cats.social)} on social sites.` });
  if (score >= 75) list.push({ title: 'Strong Productivity', desc: `Score ${score}/100 — keep the streak going.` });
  else if (score < 40 && agg.total > 3600) list.push({ title: 'Productivity Dip', desc: `Score ${score}/100. Consider focus mode.` });
  if (agg.total > 8 * 3600) list.push({ title: 'High Screen Time', desc: `Over ${fmt(agg.total)} tracked.` });
  if (agg.topSites?.[0]) list.push({ title: 'Top Site', desc: `${agg.topSites[0].domain} led at ${fmt(agg.topSites[0].totalTime)}.` });
  return list;
}

export async function createReportPDF(days = 1) {
  const report = await prepareReportData(days);
  const doc = buildReportPDF(report);
  return { doc, report, base64: pdfToBase64(doc) };
}

export async function downloadReport(days = 1) {
  const { doc, report } = await createReportPDF(days);
  downloadPDF(doc, `screen-time-${report.days}d-${new Date().toISOString().slice(0, 10)}.pdf`);
  return report;
}

function toBase64Url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMime({ to, subject, bodyText, filename, pdfBase64 }) {
  const boundary = 'stt_boundary_' + Date.now();
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    bodyText,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    pdfBase64,
    '',
    `--${boundary}--`,
  ];
  return toBase64Url(unescape(encodeURIComponent(lines.join('\r\n'))));
}

export async function sendReportViaGmail(days = 1, extraTo = '') {
  const { doc, report, base64 } = await createReportPDF(days);
  const token = await getAuthToken(true);
  const profile = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const to = [profile.email, ...(extraTo || '').split(',').map(s => s.trim()).filter(Boolean)].join(', ');
  const filename = `screen-time-${days}d.pdf`;
  const raw = buildMime({
    to,
    subject: `${report.title} — ${fmt(report.total)} · Score ${report.score}`,
    bodyText: `Hi ${profile.name || 'there'},\n\nYour Screen Time Tracker ${days <= 1 ? 'daily' : 'weekly'} summary is attached.\n\nTotal: ${fmt(report.total)}\nScore: ${report.score}/100\nTop site: ${report.topSites?.[0]?.domain || '—'}\n\n— Screen Time Tracker`,
    filename,
    pdfBase64: base64,
  });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Gmail send failed: ' + err.slice(0, 200));
  }
  return { ok: true, via: 'gmail', to, report };
}

export async function sendReportViaBackend(days = 1, extraTo = '') {
  const base = CONFIG.BACKEND_URL?.replace(/\/$/, '');
  if (!base) throw new Error('Backend not configured');
  const { user } = await chrome.runtime.sendMessage({ type: 'GET_USER' });
  if (!user?.jwt) throw new Error('Cloud login required for server email');
  const { base64, report } = await createReportPDF(days);
  const res = await fetch(`${base}/reports/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.jwt}` },
    body: JSON.stringify({
      days,
      pdfBase64: base64,
      extraEmails: extraTo,
      meta: { total: report.total, score: report.score, title: report.title },
    }),
  });
  if (!res.ok) throw new Error('Server email failed');
  return { ok: true, via: 'backend', report };
}

export async function sendReportSmart(days = 1) {
  const { settings } = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const extra = settings?.emailReports?.extraEmails || '';
  const { user } = await chrome.runtime.sendMessage({ type: 'GET_USER' });
  if (user?.provider === 'backend' && user?.jwt) {
    try { return await sendReportViaBackend(days, extra); } catch (e) { log.warn(e); }
  }
  if (user?.provider === 'google' || user?.email) {
    return await sendReportViaGmail(days, extra);
  }
  throw new Error('Sign in with Google to email reports');
}
