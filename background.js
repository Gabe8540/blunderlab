// Clicking the toolbar icon opens Blunder Lab. On a chess.com game page it opens that game.
chrome.action.onClicked.addListener(async function (tab) {
  const m = /^https:\/\/www\.chess\.com\/(?:analysis\/)?game\/(?:(?:live|daily)\/)?(\d+)/.exec((tab && tab.url) || '');
  const url = chrome.runtime.getURL('app.html') + (m ? '#game=' + m[1] : '');
  const open = await chrome.tabs.query({ url: chrome.runtime.getURL('app.html') + '*' });
  if (open.length && !m) { chrome.tabs.update(open[0].id, { active: true }); chrome.windows.update(open[0].windowId, { focused: true }); }
  else chrome.tabs.create({ url: url });
});
chrome.runtime.onInstalled.addListener(function (info) {
  if (info.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

// Once a minute, look for a game that has just finished on chess.com (played on any device).
// If Blunder Lab is open it checks for itself; if not, it is opened in a background tab and reviews the game there.
function schedule() { chrome.alarms.get('poll', a => { if (!a) chrome.alarms.create('poll', { periodInMinutes: 1 }); }); }
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
schedule();
chrome.alarms.onAlarm.addListener(async function (alarm) {
  if (alarm.name !== 'poll') return;
  try { await chrome.runtime.sendMessage({ type: 'blunderlab-ping' }); return; } catch (e) { /* no Blunder Lab tab is open */ }
  const d = await chrome.storage.local.get(['settings', 'lastEnd']), s = d.settings || {};
  const user = (s.user || '').trim().toLowerCase();
  if (s.auto === false || !d.lastEnd || !user) return;
  try {
    const now = new Date();
    const r = await fetch('https://api.chess.com/pub/player/' + encodeURIComponent(user) + '/games/' + now.getUTCFullYear() + '/' + String(now.getUTCMonth() + 1).padStart(2, '0'), { credentials: 'omit' });
    if (!r.ok) return;
    const games = ((await r.json()).games || []).filter(g => !g.rules || g.rules === 'chess');
    const newest = games.reduce((a, g) => Math.max(a, (g.end_time || 0) * 1000), 0);
    if (newest > d.lastEnd) {
      await chrome.storage.local.set({ lastEnd: newest }); // so the same game never opens a second tab
      chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '#auto', active: false });
    }
  } catch (e) { /* offline: try again next minute */ }
});
