/**
 * phase13_ai_chat_handler.test.mjs
 *
 * 짜장면 주문 사고실험 1단계 — src/worker/ai-chat-handler.js 검증.
 * 이 파일은 브라우저 의존성이 없는 순수 Worker 모듈이라(fetch/crypto만
 * 필요, Node 18+ 전역 제공) phase11/12처럼 정규식 추출 없이 실제 ESM
 * import로 바로 테스트한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAiChat, handleEscalate,
  buildSystemPrompt, detectEscalationKeyword, countRecentFails,
  aesEncrypt, aesDecrypt,
  FAIL_THRESHOLD,
} from '../../worker/ai-chat-handler.js';

function makeDeps(overrides = {}) {
  return {
    _err: (status, code, message) => new Response(JSON.stringify({ error: code, message }), {
      status, headers: { 'Content-Type': 'application/json' },
    }),
    _verifyEd25519: async () => true,
    _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '테스트 상점', address: '제주시 어딘가' }),
    sbFetch: async () => ({}),
    ...overrides,
  };
}

function req(body) {
  return new Request('https://hondi-proxy.example/biz/ai-chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG',
  session_id: 's1', message: '안녕하세요', target_guid: 'TARGET',
};

describe('N-21: handleAiChat — 필수 필드 검증', () => {
  it('guid/pubkey/signature/session_id/message/target_guid 중 하나라도 없으면 400', async () => {
    for (const field of ['guid', 'pubkey', 'signature', 'session_id', 'message', 'target_guid']) {
      const body = { ...BASE_BODY };
      delete body[field];
      const res = await handleAiChat(req(body), {}, {}, makeDeps());
      assert.equal(res.status, 400, `${field} 누락인데 400이 아님`);
    }
  });
});

describe('N-22: handleAiChat — 서명/신원 검증(Ed25519 + TOFU)', () => {
  it('서명 검증 실패 시 401', async () => {
    const deps = makeDeps({ _verifyEd25519: async () => false });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'INVALID_SIGNATURE');
  });

  it('L1에 가입 기록 없으면 404(원본 handleAiSetupPost와 동일 원칙)', async () => {
    const deps = makeDeps({ _l1FindProfileByGuid: async () => null });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'PROFILE_NOT_FOUND');
  });

  it('L1에 등록된 공개키와 요청의 pubkey가 다르면 401(TOFU 위반)', async () => {
    const deps = makeDeps({
      _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'DIFFERENT_KEY' }),
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'PUBKEY_MISMATCH');
  });
});

describe('N-23: handleAiChat — 에스컬레이션 조건', () => {
  it('메시지에 "사람 연결" 등 키워드가 있으면 즉시 escalated', async () => {
    const body = { ...BASE_BODY, message: '사람 연결해줘' };
    const res = await handleAiChat(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
    assert.equal(data.reason, 'keyword');
  });

  it('최근 10분 내 실패 3회 이상이면 escalated', async () => {
    const now = Date.now();
    const deps = makeDeps({
      sbFetch: async (env, path) => {
        if (path.includes('/ai_sessions?')) {
          return [{ mode: 'ai', messages: [
            { type: 'fail', ts: now - 1000 },
            { type: 'fail', ts: now - 2000 },
            { type: 'fail', ts: now - 3000 },
          ] }];
        }
        return {};
      },
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
    assert.equal(data.reason, 'fail_count');
  });

  it('세션이 이미 escalated 모드면 계속 escalated 유지', async () => {
    const deps = makeDeps({
      sbFetch: async (env, path) => path.includes('/ai_sessions?') ? [{ mode: 'escalated', messages: [] }] : {},
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
    assert.equal(data.reason, 'already_escalated');
  });
});

describe('N-24: handleAiChat — ai_active=false면 사람에게 전달(mode:human)', () => {
  it('대상의 LLM 키가 없거나 ai_active=false면 human 모드로 응답', async () => {
    const deps = makeDeps({
      sbFetch: async (env, path) => {
        if (path.includes('/ai_sessions?')) return [{ mode: 'ai', messages: [] }];
        if (path.includes('/user_llm_keys')) return [{ ai_active: false }];
        return {};
      },
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'human');
  });
});

describe('N-25: handleAiChat — 정상 AI 응답 경로(전체 파이프라인)', () => {
  it('대상 프로필의 메뉴/영업시간이 실제로 system 프롬프트에 반영되어 LLM에 전달됨', async () => {
    const rawKey = 'test-encryption-key-32bytes-long!!';
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);

    let capturedLlmBody = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('api.deepseek.com')) {
        capturedLlmBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '네, 짜장면 2그릇 주문 접수했습니다.' } }] }) };
      }
      return realFetch(url, opts);
    };

    try {
      const deps = makeDeps({
        _l1FindProfileByGuid: async (env, guid) => {
          if (guid === 'TARGET') {
            return {
              guid, pubkey_ed25519: 'PUBKEY', name: '동네 중국집',
              address: '제주시 어딘가',
              extra: { business_hours: '11:00~21:00', menu: [{ name: '짜장면', price: 7000 }] },
            };
          }
          return { guid, pubkey_ed25519: 'PUBKEY' };
        },
        sbFetch: async (env, path) => {
          if (path.includes('/ai_sessions?')) return [{ mode: 'ai', messages: [] }];
          if (path.includes('/user_llm_keys')) return [{ ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc }];
          return {};
        },
      });
      const body = { ...BASE_BODY, message: '짜장면 두 그릇 주문할게요' };
      const res = await handleAiChat(req(body), { AES_ENCRYPTION_KEY: rawKey }, {}, deps);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.mode, 'ai');
      assert.match(data.response, /짜장면/);

      assert.ok(capturedLlmBody, 'LLM이 실제로 호출됐어야 함');
      const systemMsg = capturedLlmBody.messages.find(m => m.role === 'system').content;
      assert.match(systemMsg, /동네 중국집/);
      assert.match(systemMsg, /11:00~21:00/);
      assert.match(systemMsg, /짜장면/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('N-26: handleEscalate — 필수 필드 및 서명 검증', () => {
  it('session_id 없으면 400', async () => {
    const body = { guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG' };
    const res = await handleEscalate(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 400);
  });

  it('정상 요청이면 escalated 응답', async () => {
    const body = { guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG', session_id: 's1' };
    const res = await handleEscalate(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
  });
});

describe('N-27: 순수 함수 — buildSystemPrompt/detectEscalationKeyword/countRecentFails', () => {
  it('buildSystemPrompt — 규칙 2(예약 외 업무는 사람 연결)가 그대로 살아있음(2단계 전이라 아직 안 바뀜)', () => {
    const prompt = buildSystemPrompt({ name: '가게', extra: {} }, null);
    assert.match(prompt, /예약 외 업무는 사람 연결을 안내/,
      '이번 1단계는 배선만 — 주문접수 규칙 추가는 합의된 2단계 범위');
  });

  it('detectEscalationKeyword — 다국어 키워드 인식', () => {
    assert.equal(detectEscalationKeyword('직원 좀 바꿔주세요'), true);
    assert.equal(detectEscalationKeyword('talk to someone please'), true);
    assert.equal(detectEscalationKeyword('그냥 메뉴만 볼게요'), false);
  });

  it('countRecentFails — 10분 지난 실패는 카운트 안 함', () => {
    const now = Date.now();
    const messages = [
      { type: 'fail', ts: now - 1000 },
      { type: 'fail', ts: now - 11 * 60 * 1000 }, // 11분 전 — 제외돼야 함
    ];
    assert.equal(countRecentFails(messages), 1);
  });

  it(`FAIL_THRESHOLD는 ${3}(원본과 동일 유지)`, () => {
    assert.equal(FAIL_THRESHOLD, 3);
  });
});

describe('N-28: aesEncrypt/aesDecrypt — 왕복 검증', () => {
  it('암호화 후 복호화하면 원문과 일치', async () => {
    const key = 'my-test-key-1234567890123456789';
    const plain = 'sk-super-secret-api-key';
    const enc = await aesEncrypt(plain, key);
    const dec = await aesDecrypt(enc, key);
    assert.equal(dec, plain);
  });
});
