/** NodeLoc Cookie capture — Loon / Surge / Quantumult X / Stash.
 * Inspired by MaYIHEI/paperclip app/nodeseek. Never prints credentials.
 */
(function () {
  const read = k => typeof $prefs !== 'undefined' ? $prefs.valueForKey(k) : $persistentStore.read(k);
  const write = (v, k) => typeof $prefs !== 'undefined' ? $prefs.setValueForKey(v, k) : $persistentStore.write(v, k);
  try {
    if (!/^https:\/\/www\.nodeloc\.com\//i.test($request.url)) return;
    const headers = $request.headers || {};
    const header = name => { const key = Object.keys(headers).find(k => k.toLowerCase() === name); return key ? String(headers[key]) : ''; };
    const cookie = header('cookie');
    const token = value => (value.match(/(?:^|;\s*)_t=([^;]+)/) || [])[1] || '';
    if (!token(cookie)) return;
    const changed = token(cookie) !== token(read('nodeloc_cookie') || '');
    write(cookie, 'nodeloc_cookie');
    const ua = header('user-agent');
    if (ua) write(ua, 'nodeloc_ua');
    if (changed) {
      write('', 'nodeloc_status');
      const args = ['NodeLoc', '✅ Cookie 已保存', '请运行签到验证登录状态'];
      if (typeof $notify !== 'undefined') $notify(...args);
      else $notification.post(...args);
    }
  } finally { $done({}); }
})();
