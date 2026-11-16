/** NodeLoc daily check-in | Loon / Surge / Quantumult X / Stash
 * Layout and status protocol inspired by MaYIHEI/paperclip/app/nodeseek.
 * NodeLoc API: GET /session/csrf.json -> POST /checkin.
 * No credentials or response bodies are logged. No automatic POST retries.
 */
(function () {
  const BASE = 'https://www.nodeloc.com';
  const read = k => typeof $prefs !== 'undefined' ? $prefs.valueForKey(k) : $persistentStore.read(k);
  const write = (v, k) => typeof $prefs !== 'undefined' ? $prefs.setValueForKey(v, k) : $persistentStore.write(v, k);
  let args = typeof $argument !== 'undefined' ? $argument : {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch (_) { args = {}; } }
  let cookie = read('nodeloc_cookie') || '';
  const ua = read('nodeloc_ua') || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const header = (headers, name) => { const k = Object.keys(headers || {}).find(k => k.toLowerCase() === name); return k ? headers[k] : ''; };
  function mergeCookies(headers) {
    const raw = header(headers, 'set-cookie');
    if (!raw) return;
    const values = Array.isArray(raw) ? raw : String(raw).split(/,(?=\s*[^;,\s]+=)/);
    const jar = {};
    cookie.split(';').forEach(part => { const i = part.indexOf('='); if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim(); });
    values.forEach(value => {
      const pair = String(value).split(';')[0], i = pair.indexOf('=');
      if (i < 1) return;
      const key = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
      const expires = String(value).match(/;\s*expires=([^;]+)/i);
      if (!val || /;\s*max-age=0(?:;|$)/i.test(value) || (expires && Date.parse(expires[1]) <= Date.now())) delete jar[key];
      else jar[key] = val;
    });
    cookie = Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
    write(cookie, 'nodeloc_cookie');
  }
  function request(method, path, extra, body) {
    const options = {url: BASE + path, headers: Object.assign({Cookie: cookie, 'User-Agent': ua, Accept: 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: BASE + '/', 'X-Requested-With': 'XMLHttpRequest'}, extra || {}), timeout: 20};
    if (body !== undefined) options.body = body;
    return new Promise((resolve, reject) => {
      function finish(err, response, data) {
        if (err) return reject(new Error(method === 'POST' ? '签到请求网络异常，结果未确认；请先到网站检查签到状态' : '获取 CSRF 的网络请求失败；请检查网络后重试'));
        if (!response) return reject(new Error('未收到服务器响应'));
        mergeCookies(response.headers || {});
        resolve({status: Number(response.status || response.statusCode), text: String(data || '')});
      }
      if (typeof $task !== 'undefined') {
        options.method = method;
        $task.fetch(options).then(r => finish(null, r, r.body), e => finish(e));
      } else {
        $httpClient[method.toLowerCase()](options, finish);
      }
    });
  }
  function decode(r) {
    if (/challenge-platform|Just a moment|cf-chl-/i.test(r.text)) throw new Error('Cloudflare 拦截；请用浏览器打开 NodeLoc 完成验证并刷新 Cookie');
    if (r.status === 403 && /BAD CSRF/i.test(r.text)) throw new Error('CSRF 校验失败；请刷新浏览器会话后再试');
    if (r.status === 401) throw new Error('登录失效；请重新登录并抓取 Cookie');
    if (r.status === 429) throw new Error('请求过于频繁，请稍后再试');
    let data;
    try { data = JSON.parse(r.text); } catch (_) { throw new Error('响应不是 JSON，HTTP ' + r.status + '；请检查登录状态或站点防护'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('响应格式异常');
    return data;
  }
  function report(s, msg) {
    let rec = {v: 1, t: Date.now(), name: 'NodeLoc', author: 'NodeLoc adaptation', s, msg: String(msg).slice(0, 200)};
    try {
      const old = JSON.parse(read('nodeloc_status') || 'null');
      const day = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
      if (s === 'ok' && msg === '今日已签到' && old && old.s === 'ok' && day(old.t) === day(rec.t)) rec = old;
    } catch (_) {}
    write(JSON.stringify(rec), 'nodeloc_status');
    let registry = {};
    try { registry = JSON.parse(read('checkin_registry') || '{}') || {}; } catch (_) {}
    if (typeof registry !== 'object' || Array.isArray(registry)) registry = {};
    registry.nodeloc_status = {name: 'NodeLoc', author: 'NodeLoc adaptation', open: BASE};
    write(JSON.stringify(registry), 'checkin_registry');
    console.log('[NodeLoc] ' + s + ': ' + msg);
    if (!(args && args.merge === true)) {
      const params = ['NodeLoc', s === 'ok' ? '✅ ' + msg : '❌ 签到未完成', s === 'ok' ? '' : msg];
      if (typeof $notify !== 'undefined') $notify(...params); else $notification.post(...params);
    }
  }
  async function main() {
    if (!/(?:^|;\s*)_t=[^;]+/.test(cookie)) { report('none', '缺少登录 Cookie；请先在浏览器登录 NodeLoc'); return; }
    const csrfResponse = await request('GET', '/session/csrf.json');
    const csrfData = decode(csrfResponse);
    if (csrfResponse.status !== 200 || typeof csrfData.csrf !== 'string' || !csrfData.csrf) throw new Error('获取 CSRF Token 失败，HTTP ' + csrfResponse.status);
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    let nonce = '';
    for (let i = 0; i < 26; i++) nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
    const r = await request('POST', '/checkin', {
      Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-CSRF-Token': csrfData.csrf, 'X-Discourse-Checkin': 'true', 'X-Checkin-Nonce': nonce
    }, 'nonce=' + encodeURIComponent(nonce) + '&timestamp=' + Date.now());
    const data = decode(r);
    const message = String(data.message || data.error || (Array.isArray(data.errors) ? data.errors.join('; ') : '') || '');
    if (r.status >= 200 && r.status < 300 && data.success === true) {
      const points = data.points;
      report('ok', '签到成功' + (typeof points === 'number' || (typeof points === 'string' && /^\d+(\.\d+)?$/.test(points)) ? '，获得 ' + points + ' 能量' : ''));
    } else if (/已.*签[到过]|已经签到|重复签到|already.*(check|sign)|(?:check|sign).*already/i.test(message) && r.status < 500) {
      report('ok', '今日已签到');
    } else if (r.status === 403 || /csrf|登录|log.?in|unauthorized/i.test(message)) {
      throw new Error('登录或 CSRF 校验失败；请刷新浏览器并重新抓取 Cookie（HTTP ' + r.status + '）');
    } else {
      throw new Error(message ? message.slice(0, 160) : '签到未成功，HTTP ' + r.status + '；接口可能已变化');
    }
  }
  main().catch(e => {
    const msg = e.message || '签到脚本发生异常';
    report(/登录|Cookie|CSRF 校验|Cloudflare/.test(msg) ? 'cookie' : 'fail', msg);
  }).finally(() => $done({}));
})();
