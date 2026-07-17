/**
 * M09 Community 모듈 테스트
 * node m09_community.test.mjs
 */

import {
  scoreContent,
  verifyJWT,
  handleListPosts,
  handleCreatePost,
  handleGetPost,
  handleCreateReply,
  handleResolve,
} from '../../profile2.0/community.js';

let pass = 0, fail = 0;
function assert(id, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${id}`); pass++; }
  else       { console.error(`  ❌ ${id}${detail ? ' — ' + detail : ''}`); fail++; }
}

// ── JWT 발급 헬퍼 ──────────────────────────────────────────────────
const MASTER_KEY = 'test-master-key-32bytes-paddingxx';

async function issueJWT(payload) {
  const iat  = Math.floor(Date.now() / 1000);
  const exp  = iat + 86400;
  const full = { ...payload, iat, exp };
  const headerB64  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64').replace(/=/g, '');
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64').replace(/=/g, '');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(MASTER_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  const sigB64 = Buffer.from(new Uint8Array(sig)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// ── DB 메모리 시뮬레이터 ──────────────────────────────────────────
let postStore   = {};
let replyStore  = {};
let ledgerStore = [];
let broadcastLog = [];
let postIdSeq   = 1;
let replyIdSeq  = 1;

function resetStore() {
  postStore    = {};
  replyStore   = {};
  ledgerStore  = [];
  broadcastLog = [];
  postIdSeq    = 1;
  replyIdSeq   = 1;
}

// fetch mock
global.fetch = async (url, opts = {}) => {
  const path = new URL(url).pathname;

  // Supabase REST 시뮬레이션
  if (url.includes('/rest/v1/community_posts')) {
    const qs = new URL(url).searchParams;

    if (!opts.method || opts.method === 'GET') {
      let posts = Object.values(postStore);
      if (qs.get('id')) {
        const idVal = qs.get('id').replace('eq.', '');
        posts = posts.filter(p => String(p.id) === idVal);
      }
      if (qs.get('is_visible')) posts = posts.filter(p => p.is_visible === true);
      if (qs.get('lang'))       posts = posts.filter(p => p.lang === qs.get('lang').replace('eq.', ''));
      if (qs.get('category')) {
        const catParam = qs.get('category');
        if (catParam.startsWith('in.(')) {
          const cats = catParam.slice(4, -1).split(',').map(c => c.replace(/"/g, '').trim());
          posts = posts.filter(p => cats.includes(p.category));
        } else {
          posts = posts.filter(p => p.category === catParam.replace('eq.', ''));
        }
      }
      const limit  = parseInt(qs.get('limit') ?? '100');
      const offset = parseInt(qs.get('offset') ?? '0');
      return { ok: true, json: async () => posts.slice(offset, offset + limit) };
    }

    if (opts.method === 'POST') {
      const data = JSON.parse(opts.body);
      const id   = postIdSeq++;
      postStore[id] = { id, ...data, created_at: new Date().toISOString() };
      return { ok: true, status: 201, json: async () => [postStore[id]] };
    }

    if (opts.method === 'PATCH') {
      const idStr = new URL(url).searchParams.get('id')?.replace('eq.', '');
      if (idStr && postStore[idStr]) {
        Object.assign(postStore[idStr], JSON.parse(opts.body));
      }
      return { ok: true, json: async () => [] };
    }
  }

  if (url.includes('/rest/v1/community_replies')) {
    const qs = new URL(url).searchParams;
    if (!opts.method || opts.method === 'GET') {
      let replies = Object.values(replyStore);
      if (qs.get('post_id'))   replies = replies.filter(r => String(r.post_id) === qs.get('post_id').replace('eq.', ''));
      if (qs.get('is_helpful')) replies = replies.filter(r => r.is_helpful === true);
      const limit = parseInt(qs.get('limit') ?? '100');
      return { ok: true, json: async () => replies.slice(0, limit) };
    }
    if (opts.method === 'POST') {
      const data = JSON.parse(opts.body);
      const id   = replyIdSeq++;
      replyStore[id] = { id, ...data, created_at: new Date().toISOString() };
      return { ok: true, status: 201, json: async () => [replyStore[id]] };
    }
  }

  if (url.includes('/rest/v1/fs_ledger')) {
    if (opts.method === 'POST') {
      const data = JSON.parse(opts.body);
      ledgerStore.push(data);
      return { ok: true, status: 201, json: async () => [data] };
    }
  }

  if (url.includes('/rest/v1/security_event')) {
    return { ok: true, status: 201, json: async () => [{}] };
  }

  // Realtime broadcast
  if (url.includes('/realtime/v1/api/broadcast')) {
    const body = JSON.parse(opts.body);
    broadcastLog.push(...body.messages);
    return { ok: true, json: async () => ({}) };
  }

  // /interpret
  if (url.includes('/interpret')) {
    const { text, to_lang } = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ translated: `[${to_lang}]${text}` }) };
  }

  return { ok: false, status: 404, text: async () => 'Not found' };
};

function makeEnv() {
  return {
    SUPABASE_URL:         'https://mock.supabase.co',
    SUPABASE_KEY:         'anon',
    SUPABASE_SERVICE_KEY: 'service',
    GOPANG_MASTER_KEY:    MASTER_KEY,
    WORKER_BASE_URL:      'https://mock.hondi.net',
  };
}

function makeRequest(method, path, body = null, token = null) {
  const url  = `https://mock.hondi.net${path}`;
  const headers = new Map();
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  return {
    method,
    url,
    headers: { get: k => headers.get(k.toLowerCase()) ?? null },
    json: async () => body ?? {},
  };
}

const env = makeEnv();

// ── C01 게시물 작성 ────────────────────────────────────────────────
console.log('\n[Community 핸들러]');
{
  resetStore();
  const token = await issueJWT({ guid: 'user-zh-01', name: '陈伟', lang: 'zh', type: 'consumer' });
  const req   = makeRequest('POST', '/community',
    { category: 'help', title: '도움 필요', body: '제주 버스 어떻게 타요?' }, token);
  const res   = await handleCreatePost(req, env);
  const data  = await res.json();
  assert('C01', res.status === 201 && data.post_id != null, `status=${res.status}`);
}

// ── C02 번역본 자동 생성 ───────────────────────────────────────────
{
  const token = await issueJWT({ guid: 'user-zh-01', name: '陈伟', lang: 'zh', type: 'consumer' });
  const req   = makeRequest('POST', '/community',
    { category: 'help', title: 'Help', body: '中文内容' }, token);
  await handleCreatePost(req, env);
  const post = Object.values(postStore).find(p => p.body === '中文内容');
  assert('C02', post?.body_translated?.includes('[ko]'), `body_translated=${post?.body_translated}`);
}

// ── C03 긴급 Realtime 브로드캐스트 ────────────────────────────────
{
  resetStore(); broadcastLog = [];
  const token = await issueJWT({ guid: 'user-01', name: '테스트', lang: 'zh', type: 'consumer' });
  const req   = makeRequest('POST', '/community',
    { category: 'emergency', title: '응급 상황!', body: 'Help!' }, token);
  await handleCreatePost(req, env);
  assert('C03',
    broadcastLog.some(m => m.topic.startsWith('community:zh:emergency')),
    `broadcastLog=${JSON.stringify(broadcastLog.map(m => m.topic))}`);
}

// ── C04 한국어 댓글 → zh 번역 ─────────────────────────────────────
{
  // zh 게시물 먼저 작성
  const zhToken = await issueJWT({ guid: 'user-zh', name: '陈伟', lang: 'zh', type: 'consumer' });
  const postReq = makeRequest('POST', '/community',
    { category: 'help', title: 'zh post', body: '中文' }, zhToken);
  const postRes = await handleCreatePost(postReq, env);
  const { post_id } = await postRes.json();

  // 한국인 댓글
  const koToken = await issueJWT({ guid: 'user-ko', name: '김민준', lang: 'ko', type: 'consumer' });
  const repReq  = makeRequest('POST', `/community/${post_id}/reply`,
    { body: '제주 버스는 앱을 사용하세요!' }, koToken);
  await handleCreateReply(repReq, env, String(post_id));

  const replies = Object.values(replyStore);
  const reply   = replies.find(r => r.post_id == post_id);
  assert('C04', reply?.body_translated?.includes('[zh]'), `body_translated=${reply?.body_translated}`);
}

// ── C05 해결 완료 (작성자) ─────────────────────────────────────────
{
  resetStore();
  const token = await issueJWT({ guid: 'author-01', name: '작성자', lang: 'zh', type: 'consumer' });
  const postReq = makeRequest('POST', '/community',
    { category: 'help', title: 'test', body: 'body' }, token);
  const postRes = await handleCreatePost(postReq, env);
  const { post_id } = await postRes.json();

  const resReq = makeRequest('POST', `/community/${post_id}/resolve`, {}, token);
  const resRes = await handleResolve(resReq, env, String(post_id));
  const data   = await resRes.json();
  assert('C05', resRes.status === 200 && data.is_resolved === true, `status=${resRes.status}`);
}

// ── C06 타인 해결 시도 → 403 ──────────────────────────────────────
{
  resetStore();
  const authorToken = await issueJWT({ guid: 'author-01', name: '작성자', lang: 'zh', type: 'consumer' });
  const otherToken  = await issueJWT({ guid: 'other-99',  name: '타인',   lang: 'ko', type: 'consumer' });

  const postReq = makeRequest('POST', '/community',
    { category: 'help', title: 'test', body: 'body' }, authorToken);
  const postRes = await handleCreatePost(postReq, env);
  const { post_id } = await postRes.json();

  const resReq = makeRequest('POST', `/community/${post_id}/resolve`, {}, otherToken);
  const resRes = await handleResolve(resReq, env, String(post_id));
  assert('C06', resRes.status === 403, `status=${resRes.status}`);
}

// ── C07 봉사자 GDC 지급 ───────────────────────────────────────────
{
  resetStore();
  const authorToken    = await issueJWT({ guid: 'author-01',    lang: 'zh', type: 'consumer' });
  const volunteerToken = await issueJWT({ guid: 'volunteer-01', lang: 'ko', type: 'consumer' });

  const postReq = makeRequest('POST', '/community',
    { category: 'help', title: 'test', body: 'body' }, authorToken);
  const postRes = await handleCreatePost(postReq, env);
  const { post_id } = await postRes.json();

  // is_helpful=true 댓글
  const repReq = makeRequest('POST', `/community/${post_id}/reply`,
    { body: '해결책입니다!', is_helpful: true }, volunteerToken);
  await handleCreateReply(repReq, env, String(post_id));

  // 해결 완료
  const resReq = makeRequest('POST', `/community/${post_id}/resolve`, {}, authorToken);
  await handleResolve(resReq, env, String(post_id));

  const credit = ledgerStore.find(l => l.direction === 'credit' && l.amount === 500);
  assert('C07',
    credit?.guid === 'volunteer-01' && credit?.source === 'manual',
    `ledger=${JSON.stringify(credit)}`);
}

// ── C08 K-Security 필터 ───────────────────────────────────────────
{
  const score = scoreContent('쓰레기쓰레기쓰레기 buy now http://spam.com');
  assert('C08-scoreContent', score >= 0.6, `score=${score}`);

  resetStore();
  const token = await issueJWT({ guid: 'user-01', lang: 'ko', type: 'consumer' });
  const req   = makeRequest('POST', '/community',
    { category: 'help', title: '스팸', body: '쓰레기쓰레기쓰레기쓰레기쓰레기쓰레기' }, token);
  const res   = await handleCreatePost(req, env);
  const data  = await res.json();
  // is_visible=false 로 저장되어야 함
  const storedPost = Object.values(postStore).find(p => p.title === '스팸');
  assert('C08', data.is_visible === false && storedPost?.is_visible === false,
    `is_visible=${data.is_visible}`);
}

// ── C09 근접 정렬 ─────────────────────────────────────────────────
{
  resetStore();
  // 3개 게시물 직접 삽입
  postStore[1] = { id: 1, lang: 'zh', category: 'help', title: 'far',  lat: 33.50, lng: 126.50, is_visible: true, reply_count: 0, created_at: new Date().toISOString() };
  postStore[2] = { id: 2, lang: 'zh', category: 'help', title: 'near', lat: 33.39, lng: 126.24, is_visible: true, reply_count: 0, created_at: new Date().toISOString() };
  postStore[3] = { id: 3, lang: 'zh', category: 'help', title: 'mid',  lat: 33.43, lng: 126.35, is_visible: true, reply_count: 0, created_at: new Date().toISOString() };

  const req  = makeRequest('GET', '/community?lang=zh&near_lat=33.39&near_lng=126.24');
  const res  = await handleListPosts(req, env);
  const data = await res.json();
  assert('C09', data.posts[0].title === 'near', `first=${data.posts[0].title}`);
}

// ── C10 미인증 쓰기 → 401 ─────────────────────────────────────────
{
  resetStore();
  const req = makeRequest('POST', '/community',
    { category: 'help', title: 'test', body: 'body' }, null);
  const res = await handleCreatePost(req, env);
  assert('C10', res.status === 401, `status=${res.status}`);
}

// ── C11 미인증 읽기 허용 ──────────────────────────────────────────
{
  resetStore();
  postStore[1] = { id: 1, lang: 'zh', category: 'help', title: '공개글', is_visible: true, reply_count: 0, created_at: new Date().toISOString() };
  const req  = makeRequest('GET', '/community?lang=zh');
  const res  = await handleListPosts(req, env);
  const data = await res.json();
  assert('C11', res.status === 200 && data.posts.length === 1, `status=${res.status}`);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
