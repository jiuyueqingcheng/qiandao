// My API daily check-in, using AgentRouter-style account/password module args.
// Target is a New API dashboard, not its model /v1 API.
const BASE = 'https://myapi.286600.xyz';
const STORE_KEY = 'myapi_286600_refresh_cookie';
const args = (() => {
  try { return typeof $argument === 'string' ? JSON.parse($argument) : ($argument || {}); }
  catch (_) { return {}; }
})();
const username = String(args.username || '').trim();
const password = String(args.password || '');
const debug = args.debug === true || args.debug === 'true';
const done = value => { if (typeof $done !== 'undefined') $done(value || {}); };
const read = k => typeof $persistentStore !== 'undefined' ? $persistentStore.read(k) : (typeof $prefs !== 'undefined' ? $prefs.valueForKey(k) : null);
const write = (v,k) => typeof $persistentStore !== 'undefined' ? $persistentStore.write(v,k) : (typeof $prefs !== 'undefined' ? $prefs.setValueForKey(v,k) : false);
function notify(title, subtitle, body) {
  if (typeof $notification !== 'undefined') $notification.post(title, subtitle || '', body || '');
  else if (typeof $notify !== 'undefined') $notify(title, subtitle || '', body || '');
}
function log(s) { if (debug) console.log('[My API签到] ' + s); }
function header(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}
function findRefreshCookie(headers) {
  let raw = header(headers, 'set-cookie');
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : String(raw).split(/,(?=\s*[^;,\s]+=)/);
  for (const line of list) {
    const match = String(line).match(/(?:^|[,;\s])new_api_refresh=([^;\s,]+)/i);
    if (match) return match[1];
  }
  return '';
}
function request(method, path, body, refreshCookie) {
  const headers = {Accept:'application/json', Origin:BASE, Referer:BASE+'/', 'User-Agent':'Surge MyAPI Checkin'};
  if (refreshCookie) headers.Cookie = 'new_api_refresh=' + refreshCookie + '; new_api_has_session=1';
  const req = {url:BASE+path, headers, timeout:25};
  if (body !== undefined) { headers['Content-Type']='application/json'; req.body=JSON.stringify(body); }
  return new Promise(resolve => {
    const finish=(err,resp,data)=>resolve({err,resp,body:data,headers:(resp&&resp.headers)||{},status:Number(resp&&(resp.status||resp.statusCode)||0)});
    if (typeof $task !== 'undefined') {
      req.method=method;
      $task.fetch(req).then(r=>finish(null,r,r.body),e=>finish(e,null,''));
    } else {
      $httpClient[method.toLowerCase()](req,finish);
    }
  });
}
function parse(r) { try { return typeof r.body === 'string' ? JSON.parse(r.body) : (r.body || {}); } catch (_) { return {}; } }
async function login() {
  const r=await request('POST','/api/user/login?turnstile=',{username,password});
  if(r.err || r.status<200 || r.status>=300) throw new Error(r.status===0?'登录请求网络失败':'登录失败（HTTP '+r.status+'）；请检查账号密码或站点验证要求');
  const data=parse(r);
  const refresh=findRefreshCookie(r.headers);
  if(data.success!==true || !data.data || !data.data.access_token || !refresh) {
    if(/turnstile/i.test(String(data.message||''))) throw new Error('站点要求 Turnstile 验证，需先在网站完成验证');
    throw new Error('登录未返回可续期会话；检查密码登录、验证码或站点策略');
  }
  write(refresh,STORE_KEY);
  log('登录成功并保存了轮换会话凭据');
  return {token:data.data.access_token,cookie:refresh};
}
async function refresh(cookie) {
  const r=await request('POST','/api/user/auth/refresh',undefined,cookie);
  if(r.err || r.status<200 || r.status>=300) return {ok:false,status:r.status,message:parse(r).message||''};
  const data=parse(r);
  if(data.success!==true || !data.data || !data.data.access_token) return {ok:false,status:r.status,message:data.message||''};
  const rotated=findRefreshCookie(r.headers);
  if(!rotated) return {ok:false,status:r.status,message:'refresh cookie rotation missing'};
  write(rotated,STORE_KEY);
  log('刷新会话成功');
  return {ok:true,token:data.data.access_token,cookie:rotated};
}
async function checkin(token) {
  const req={url:BASE+'/api/user/checkin',headers:{Authorization:'Bearer '+token,Accept:'application/json',Origin:BASE,Referer:BASE+'/'},timeout:25};
  const handle=(err,resp,raw)=>{
    if(err||!resp){notify('My API签到','请求失败','请检查网络；不要在日志中粘贴账号凭据。');return done();}
    const status=Number(resp.status||resp.statusCode||0);let data={};try{data=typeof raw==='string'?JSON.parse(raw):(raw||{});}catch(_){}
    const message=String(data.message||data.error||'');
    if(status>=200&&status<300&&data.success===true){const quota=data.data&&data.data.quota_awarded;notify('My API签到','✅ 签到成功',quota==null?message||'':`获得额度：${quota}`);}
    else if(/already checked in today|already checked in/i.test(message))notify('My API签到','ℹ️ 今日已签到','服务器确认今天已有签到记录。');
    else if(status===401||status===403)notify('My API签到','认证或验证失败','登录会话失效，或网站要求 Turnstile 验证。请先检查站点设置。');
    else notify('My API签到','❌ 签到失败（HTTP '+status+'）',message&&!/token|bearer|authorization|password/i.test(message)?message.slice(0,140):'接口未返回明确成功状态');
    log('签到请求完成：HTTP '+status+', success='+(data.success===true));done();
  };
  const reqPromise=typeof $task!=='undefined'?$task.fetch(Object.assign({method:'POST',body:''},req)).then(x=>handle(null,x,x.body),e=>handle(e,null,'')):$httpClient.post(req,handle);
  return reqPromise;
}
async function main() {
  if(!username || !password) throw new Error('请在 Surge 模块参数中填写网站账号和密码');
  let auth;
  const old=read(STORE_KEY);
  if(old) {
    const result=await refresh(String(old));
    if(result.ok) auth=result;
    else if(result.status===401) {
      log('续期凭据失效，尝试重新登录'); auth=await login();
    } else {
      throw new Error(result.status===0?'刷新登录态网络失败':'刷新登录态失败（HTTP '+result.status+'）；检查会话或站点验证要求');
    }
  } else auth=await login();
  await checkin(auth.token);
}
main().catch(e=>{const message=e&&e.message?e.message:'脚本运行失败';console.log('[My API签到] '+message);notify('My API签到','❌ '+message,'不会在通知或日志中输出账号密码、refresh cookie 或 access token。');done();});
