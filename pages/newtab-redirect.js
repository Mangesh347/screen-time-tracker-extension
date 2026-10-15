// Bounce cached/overridden New Tab to Chrome's default NTP (MV3-safe, no inline script).
// Prefer chrome://new-tab-page/ ; fallback chrome://newtab/
const NTP_PRIMARY = 'chrome://new-tab-page/';
const NTP_FALLBACK = 'chrome://newtab/';

function goNtp(url) {
  chrome.tabs.getCurrent().then((tab) => {
    if (tab?.id != null) {
      chrome.tabs.update(tab.id, { url }).catch(() => {
        location.replace(url === NTP_PRIMARY ? NTP_FALLBACK : NTP_PRIMARY);
      });
    } else {
      location.replace(url);
    }
  }).catch(() => {
    try {
      location.replace(url);
    } catch (_) {
      location.replace(NTP_FALLBACK);
    }
  });
}

goNtp(NTP_PRIMARY);
