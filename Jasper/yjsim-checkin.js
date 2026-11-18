/* Jasper API (api.yjs.im) daily check-in for Surge. */
const BASE = 'https://api.yjs.im';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

function parseArguments(raw) {
  const out = {};
  String(raw || '').split('&').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = decodeURIComponent(part.slice(0, i).replace(/\+/g, ' '));
    const value = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
    out[key] = value;
  });
  return out;
}

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      url: BASE + path,
      headers: Object.assign({
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: BASE,
        Referer: BASE + '/login',
      }, headers || {}),
      timeout: 20,
      'auto-redirect': false,
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const fn = method === 'POST' ? $httpClient.post : $httpClient.get;
    fn(options, (error, response, text) => {
      if (error || !response) return reject(new Error('网络请求失败，请检查 Surge 网络/策略。'));
      const status = Number(response.status || response.statusCode);
      if (status < 200 || status >= 300) return reject(new Error('接口返回 HTTP ' + status + '。'));
      let json;
      try { json = JSON.parse(text); } catch (_) { return reject(new Error('接口返回非 JSON 内容，可能需要网页验证。')); }
      if (!json || typeof json !== 'object' || Array.isArray(json)) return reject(new Error('接口响应格式异常。'));
      resolve({ json, headers: response.headers || {} });
    });
  });
}

function cookieFrom(headers) {
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'set-cookie');
  const raw = key ? [].concat(headers[key]).join('\n') : '';
  const match = raw.match(/(?:^|[\n,])\s*(?:set-cookie:\s*)?(session=[^;\s,]+)/i);
  return match ? match[1] : '';
}

function done(title, body) {
  try { $notification.post(title, body, ''); } catch (_) {}
  console.log(title + '\n' + body);
  $done();
}

async function run() {
  const args = parseArguments(typeof $argument === 'undefined' ? '' : $argument);
  const username = (args.username || '').trim();
  const password = args.password || '';
  if (!username || !password) throw new Error('请在 Surge 模块参数中填写 username 和 password。');

  const login = await request('POST', '/api/user/login', {}, { username, password });
  if (login.json.success !== true) {
    done('Jasper API 签到：登录失败', login.json.message || '请确认账号密码、账号状态或网页验证要求。');
    return;
  }
  const user = login.json.data;
  const cookie = cookieFrom(login.headers);
  if (!user || !Number.isInteger(user.id) || !cookie) throw new Error('登录响应缺少用户编号或 session Cookie，无法安全继续。');
  const auth = { Cookie: cookie, 'New-API-User': String(user.id), Referer: BASE + '/console' };

  const checkin = await request('POST', '/api/user/checkin', auth, {});
  const message = String(checkin.json.message || '');
  const already = checkin.json.success !== true && /已签到|今日已|already.*check.?in/i.test(message);
  if (checkin.json.success !== true && !already) throw new Error('签到接口未确认成功：' + (message || '未知响应'));

  let balanceText = '';
  try {
    const profile = await request('GET', '/api/user/self', auth);
    const data = profile.json && profile.json.data;
    if (profile.json.success === true && data && typeof data.quota === 'number' && Number.isFinite(data.quota)) {
      const status = await request('GET', '/api/status', {});
      const unit = status.json && status.json.data && status.json.data.quota_per_unit;
      if (typeof unit === 'number' && Number.isFinite(unit) && unit > 0) {
        balanceText = '当前余额：' + (data.quota / unit).toFixed(2) + '\n';
      } else balanceText = '当前额度：' + data.quota + '\n';
    }
  } catch (_) { balanceText = '余额暂未取得\n'; }

  const reward = checkin.json.data && (checkin.json.data.quota_awarded ?? checkin.json.data.quota);
  const result = already ? '今日已签到' : '签到成功' + (reward !== undefined ? '（奖励额度：' + reward + '）' : '');
  done('Jasper API 签到：' + result, balanceText + '账号：' + username.replace(/^(.{2}).+(@.*)$/, '$1***$2'));
}

run().catch(error => done('Jasper API 签到：执行失败', error && error.message ? error.message : String(error)));
