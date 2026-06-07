// gopang-auth.js — 인증(MediaPipe·카메라·지문·시드·등록·복구)
async function _loadMediaPipe() {
  if (_mpFaceLandmarker) return _mpFaceLandmarker;
  if (_mpLoading) {
    // 이미 로딩 중이면 완료 대기
    await new Promise(r => {
      const t = setInterval(() => {
        if (_mpFaceLandmarker) { clearInterval(t); r(); }
      }, 100);
    });
    return _mpFaceLandmarker;
  }
  _mpLoading = true;
  try {
    const { FaceLandmarker, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
    );
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    _mpFaceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      outputFaceBlendshapes: false,
      runningMode: 'IMAGE',
      numFaces: 1,
    });
    console.info('[MediaPipe] FaceLandmarker 로드 완료');
  } catch(e) {
    console.warn('[MediaPipe] 로드 실패 — 얼굴 인증 비활성화:', e.message);
    _mpFaceLandmarker = null;
  }
  _mpLoading = false;
  return _mpFaceLandmarker;
}

// ── 얼굴 벡터 추출 ──────────────────────────────────────
// 468개 랜드마크 → 128차원 정규화 벡터
async function _extractFaceVector(imageEl) {
  const lm = _mpFaceLandmarker;
  if (!lm) return null;
  const result = lm.detect(imageEl);
  if (!result.faceLandmarks?.length) return null;
  const pts = result.faceLandmarks[0];            // 468개 {x,y,z}

  // 코 끝(1번)을 원점으로 정규화
  const nose  = pts[1];
  const scale = Math.hypot(
    pts[33].x - pts[263].x,   // 양눈 간격
    pts[33].y - pts[263].y
  ) || 1;

  // 주요 68개 랜드마크만 추출 (계산 효율)
  const KEY_IDX = [
    1,33,263,61,291,199,
    130,359,243,463,70,300,
    105,334,52,282,159,386,
    145,374,468,469,470,471,
    0,17,18,200,199,175,
    37,267,39,269,40,270,
    185,409,61,291,78,308,
    80,310,81,311,82,312,
    13,14,87,317,88,318,
    95,325,78,308,191,415,
    107,336,55,285,8,9,
    10,151,10,8,168,6,
  ];
  const vec = [];
  for (const i of KEY_IDX) {
    const p = pts[i % pts.length];
    vec.push((p.x - nose.x) / scale);
    vec.push((p.y - nose.y) / scale);
  }
  return vec;
}

// ── 코사인 유사도 ────────────────────────────────────────
function _cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── 전면 카메라로 얼굴 촬영 후 벡터 반환 ───────────────
function _captureFaceVector() {
  return new Promise((resolve) => {
    // 전면 카메라 전용 UI 오버레이 표시
    _showFaceCaptureUI(async (imageDataUrl) => {
      if (!imageDataUrl) { resolve(null); return; }
      const img = new Image();
      img.onload = async () => {
        await _loadMediaPipe();
        const vec = await _extractFaceVector(img);
        resolve(vec);
      };
      img.src = imageDataUrl;
    });
  });
}

// ── 전면 카메라 UI (전면 고정) ──────────────────────────
function _showFaceCaptureUI(onCapture) {
  // 기존 UI 제거
  document.getElementById('_face-capture-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id    = '_face-capture-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:#000;display:flex;flex-direction:column',
    'align-items:center;justify-content:center;gap:16px',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <p id="_face-guide" style="color:#fff;font-size:14px;margin:0;
       letter-spacing:-0.3px;text-align:center;line-height:1.5;">
      카메라를 시작하는 중…
    </p>
    <div style="position:relative;width:260px;height:260px;">
      <video id="_face-video"
        style="width:260px;height:260px;border-radius:50%;object-fit:cover;
               transform:scaleX(-1);background:#111;"
        autoplay playsinline muted></video>
      <div style="position:absolute;inset:0;border-radius:50%;
                  border:3px solid rgba(62,207,142,0.8);pointer-events:none;"></div>
    </div>
    <div id="_face-error" style="display:none;background:rgba(239,68,68,0.15);
         border:1px solid rgba(239,68,68,0.4);border-radius:10px;
         padding:12px 16px;text-align:center;max-width:280px;">
      <p style="color:#fca5a5;font-size:13px;margin:0 0 8px;line-height:1.5;"></p>
      <button id="_face-retry-btn"
        style="background:#3ecf8e;color:#fff;border:none;border-radius:6px;
               padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;">
        다시 시도
      </button>
    </div>
    <button id="_face-snap-btn" disabled
      style="background:#3ecf8e;color:#fff;border:none;border-radius:8px;
             padding:14px 40px;font-size:16px;font-weight:600;cursor:pointer;
             opacity:0.4;transition:opacity 0.3s;">
      촬영
    </button>
    <button id="_face-cancel-btn"
      style="background:transparent;color:rgba(255,255,255,0.5);
             border:none;font-size:13px;cursor:pointer;padding:8px;">
      취소
    </button>
  `;
  document.body.appendChild(overlay);

  let stream = null;

  const _stop = () => {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    overlay.remove();
  };

  const _showError = (msg) => {
    const errBox  = document.getElementById('_face-error');
    const errMsg  = errBox?.querySelector('p');
    const snapBtn = document.getElementById('_face-snap-btn');
    const guide   = document.getElementById('_face-guide');
    if (errMsg)  errMsg.textContent  = msg;
    if (errBox)  errBox.style.display = 'block';
    if (snapBtn) { snapBtn.disabled = true; snapBtn.style.opacity = '0.4'; }
    if (guide)   guide.textContent  = '카메라 권한이 필요합니다';
  };

  // ── 카메라 시작 (제약 조건 단순화) ──────────────────────
  const _startCamera = (constraints) => {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(s => {
        stream = s;
        const v    = document.getElementById('_face-video');
        const btn  = document.getElementById('_face-snap-btn');
        const guide = document.getElementById('_face-guide');
        if (v)     v.srcObject = s;
        if (btn)   { btn.disabled = false; btn.style.opacity = '1'; }
        if (guide) guide.textContent = '얼굴을 원 안에 맞추고 촬영하세요';
      })
      .catch(err => {
        console.warn('[FaceCapture] 카메라 실패:', err.name, err.message);

        // 제약 조건 완화 후 재시도
        if (constraints.video?.width && err.name !== 'NotAllowedError') {
          console.info('[FaceCapture] 제약 완화 후 재시도...');
          _startCamera({ video: { facingMode: 'user' } });
          return;
        }

        // 권한 거부 또는 기기 없음
        if (err.name === 'NotAllowedError') {
          _showError('카메라 권한이 거부됐습니다.\n설정 → Safari/Chrome → 카메라를 허용해 주세요.');
        } else if (err.name === 'NotFoundError') {
          _showError('전면 카메라를 찾을 수 없습니다.');
        } else if (err.name === 'NotReadableError') {
          _showError('카메라가 다른 앱에서 사용 중입니다.\n다른 앱을 닫고 다시 시도해 주세요.');
        } else {
          _showError(`카메라 오류: ${err.message}`);
        }
      });
  };

  // 처음엔 전면 + 해상도 지정으로 시도
  _startCamera({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } } });

  // ── 다시 시도 버튼 ────────────────────────────────────
  document.getElementById('_face-retry-btn').onclick = () => {
    const errBox = document.getElementById('_face-error');
    if (errBox) errBox.style.display = 'none';
    _startCamera({ video: { facingMode: 'user' } });
  };

  // ── 촬영 버튼 ────────────────────────────────────────
  document.getElementById('_face-snap-btn').onclick = () => {
    const v = document.getElementById('_face-video');
    if (!v || !stream) { _stop(); onCapture(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width  = v.videoWidth  || 640;
    canvas.height = v.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    // 좌우 반전 원복
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    _stop();
    onCapture(canvas.toDataURL('image/jpeg', 0.85));
  };

  // ── 취소 버튼 ────────────────────────────────────────
  document.getElementById('_face-cancel-btn').onclick = () => {
    _stop(); onCapture(null);
  };
}

// ── 기기 핑거프린트 (SHA-256, IPv6 유도용) ──────────────
async function _buildDeviceFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory        || '',
    screen.pixelDepth             || '',
  ].join('|');
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(raw)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── 4단어 시드 → 32바이트 마스터 시드 ──────────────────
async function _seedToBytes(words4) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(words4.trim().toLowerCase()),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt: new TextEncoder().encode('gopang-v2-salt'),
      iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  return new Uint8Array(bits);
}

// ── IPv6 형식 정체성 생성 ────────────────────────────────
// 기기 핑거프린트 SHA-256 → IPv6 형식 (문서용 블록 2001:db8::/32)
async function _buildIPv6Identity(fpHex) {
  // fpHex 앞 16바이트(32 hex chars) → IPv6 8그룹
  const groups = [];
  for (let i = 0; i < 8; i++) {
    groups.push(fpHex.slice(i*4, i*4+4));
  }
  // 고팡 전용 prefix: 2601::/16 (문서용이 아닌 고팡 할당 블록)
  groups[0] = '2601';
  groups[1] = 'db80';   // 고팡 식별자
  return groups.join(':');
}

// ── 사용자 등록/식별 (v2.0) ─────────────────────────────
(async () => {
const _USER = await (async () => {
  const STORE_KEY = 'gopang_user_v3';
  const stored    = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  const fpHex     = await _buildDeviceFingerprint();
  const ipv6      = await _buildIPv6Identity(fpHex);

  // ── L0: 기기 일치 → 자동 로그인 ────────────────────
  if (stored?.ipv6 && stored?.fpHex === fpHex) {
    console.info('[Auth v2] L0 자동 로그인 ✅', stored.ipv6);
    return stored;
  }

  // ── 기기 변경 감지 → 복원 UI 표시 ──────────────────
  if (stored?.ipv6 && stored?.fpHex !== fpHex) {
    console.warn('[Auth v2] 기기 변경 감지 — 복원 필요');
    _showRestoreUI(stored, fpHex, ipv6);
    // 복원 완료까지 임시 사용자로 진행
    return { ipv6, fpHex, isTemp: true,
             registeredAt: new Date().toISOString() };
  }

  // ── 신규 사용자 → 등록 UI ────────────────────────
  console.info('[Auth v2] 신규 사용자 — 등록 시작');
  _showRegisterUI(fpHex, ipv6);

  // 등록 완료까지 임시 진행
  return { ipv6, fpHex, isTemp: true,
           registeredAt: new Date().toISOString() };
})();

// 하위 호환성 (기존 코드 USER_GUID 참조 유지)
const USER_GUID = _USER.ipv6 || _USER.guid || crypto.randomUUID();

// ── Supabase upsert (ipv6 + fp만, 개인정보 없음) ────────
async function _upsertUserRecord(user) {
  try {
    await fetch(_SUPABASE_URL + '/rest/v1/users', {
      method: 'POST',
      headers: {
        'apikey':       _SUPABASE_KEY,
        'Authorization':'Bearer ' + _SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer':       'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        guid:          user.ipv6,        // ipv6가 새 primary key
        device_fp:     user.fpHex?.slice(0,32),
        registered_at: user.registeredAt,
        last_seen_at:  new Date().toISOString(),
      }),
    });
  } catch(e) {
    console.warn('[Auth v2] upsert 실패 (무시):', e.message);
  }
}

// ── 신규 등록 UI ─────────────────────────────────────────
function _showRegisterUI(fpHex, ipv6) {
  setTimeout(async () => {
    // MediaPipe 백그라운드 로드 시작
    _loadMediaPipe().catch(() => {});

    appendBubble('ai',
      '👋 고팡에 처음 오셨군요!<br><br>' +
      '본인 인증을 위해 다음 두 가지를 등록합니다.<br><br>' +
      '1️⃣ <b>얼굴 등록</b> — 내부 카메라로 촬영<br>' +
      '2️⃣ <b>4단어 시드</b> — 기기 분실 시 복원용<br><br>' +
      '<small style="color:var(--label-3);">' +
      '얼굴 이미지는 기기 밖으로 전송되지 않습니다.</small>',
      true
    );

    // 얼굴 등록 버튼 주입
    setTimeout(() => _injectRegisterButtons(fpHex, ipv6), 600);
  }, 1000);
}

function _injectRegisterButtons(fpHex, ipv6) {
  const list = document.getElementById('message-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_reg-btns';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="_startFaceRegister('${fpHex}','${ipv6}')"
        style="background:var(--tint);color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        📷 얼굴 등록
      </button>
      <button onclick="_skipFaceRegister('${fpHex}','${ipv6}')"
        style="background:var(--bg-subtle);color:var(--label-2);
               border:1px solid var(--sep);border-radius:8px;
               padding:10px 16px;font-size:13px;cursor:pointer;">
        나중에
      </button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

// ── 얼굴 등록 실행 ──────────────────────────────────────
window._startFaceRegister = async function(fpHex, ipv6) {
  document.getElementById('_reg-btns')?.remove();
  appendBubble('ai', '📷 전면 카메라를 실행합니다…', true);

  const vec = await _captureFaceVector();
  if (!vec) {
    appendBubble('ai', '촬영이 취소됐습니다. 나중에 등록할 수 있습니다.', true);
    _showSeedUI(fpHex, ipv6, null);
    return;
  }
  appendBubble('ai', '✅ 얼굴 등록 완료! 이제 4단어 시드를 설정합니다.', true);
  _showSeedUI(fpHex, ipv6, vec);
};

window._skipFaceRegister = function(fpHex, ipv6) {
  document.getElementById('_reg-btns')?.remove();
  _showSeedUI(fpHex, ipv6, null);
};

// ── 4단어 시드 설정 UI ───────────────────────────────────
function _showSeedUI(fpHex, ipv6, faceVec) {
  const list = document.getElementById('message-list');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.innerHTML = `
    <div style="background:var(--bg-subtle);border-radius:12px;
                padding:16px;width:100%;max-width:320px;">
      <p style="font-size:13px;color:var(--label);margin:0 0 10px;font-weight:600;">
        🔑 복원용 4단어 시드
      </p>
      <p style="font-size:12px;color:var(--label-3);margin:0 0 12px;line-height:1.5;">
        기기 분실 시 정체성 복원에 사용됩니다.<br>
        기억하기 쉬운 단어 4개를 입력하세요.<br>
        <b>절대 타인에게 알려주지 마세요.</b>
      </p>
      <input id="_seed-input" type="text"
        placeholder="예: 제주 파란 파도 2018"
        style="width:100%;padding:10px 12px;border-radius:8px;
               border:1px solid var(--sep-strong);font-size:14px;
               background:var(--bg);color:var(--label);
               box-sizing:border-box;margin-bottom:10px;"/>
      <button onclick="_completeSeedRegister('${fpHex}','${ipv6}',${faceVec ? 'true' : 'false'})"
        style="width:100%;background:var(--tint);color:#fff;border:none;
               border-radius:8px;padding:11px;font-size:14px;
               font-weight:600;cursor:pointer;">
        등록 완료
      </button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

// ── 등록 완료 처리 ──────────────────────────────────────
window._completeSeedRegister = async function(fpHex, ipv6, hasFace) {
  const seedInput = document.getElementById('_seed-input');
  const words     = seedInput?.value?.trim() || '';

  if (words.split(/\s+/).length < 4) {
    appendBubble('ai', '⚠️ 단어 4개를 공백으로 구분하여 입력하세요.', true);
    return;
  }

  const seedBytes  = await _seedToBytes(words);
  const seedHex    = Array.from(seedBytes).map(b=>b.toString(16).padStart(2,'0')).join('');
  const faceVec    = hasFace ? (window._tempFaceVec || null) : null;

  // 기존 데이터 보존 + 새 필드 추가
  const existing = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
  const user = {
    ...existing,           // 기존 데이터 유지
    ipv6,
    fpHex,
    seedHex,
    faceVec,
    authLevel:   faceVec ? 'L1' : 'L0',
    registeredAt: existing?.registeredAt || new Date().toISOString(),
    lastSeenAt:   new Date().toISOString(),
  };

  localStorage.setItem('gopang_user_v3', JSON.stringify(user));
  _upsertUserRecord(user);

  // 시드 입력 행 제거
  document.querySelectorAll('.msg-row.ai').forEach(el => {
    if (el.querySelector('#_seed-input')) el.remove();
  });

  appendBubble('ai',
    `✅ 얼굴·시드 등록 완료!<br><br>` +
    `🆔 <code style="font-size:11px;">${ipv6}</code><br><br>` +
    `마지막으로 <b>지문 등록</b>을 하면 인증 레벨이 L2로 높아집니다.`,
    true
  );

  // 지문 등록 버튼 주입
  setTimeout(() => _injectFingerprintButton(ipv6), 500);
};

// ── 지문 등록 버튼 주입 ─────────────────────────────────
function _injectFingerprintButton(ipv6) {
  const list = document.getElementById('message-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_fp-btns';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="_registerFingerprint('${ipv6}')"
        style="background:var(--tint);color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        🔐 지문 등록
      </button>
      <button onclick="_skipFingerprint()"
        style="background:var(--bg-subtle);color:var(--label-2);
               border:1px solid var(--sep);border-radius:8px;
               padding:10px 16px;font-size:13px;cursor:pointer;">
        나중에
      </button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

// ── 지문 등록 실행 ──────────────────────────────────────
window._registerFingerprint = async function(ipv6) {
  document.getElementById('_fp-btns')?.remove();

  // WebAuthn 지원 여부 확인
  if (!window.PublicKeyCredential) {
    appendBubble('ai', '⚠️ 이 브라우저는 지문 인증을 지원하지 않습니다.', true);
    return;
  }

  appendBubble('ai', '🔐 지문 인증을 등록합니다. 기기의 지문 센서를 사용해 주세요.', true);

  try {
    // 1. Worker에서 챌린지 발급
    const chalRes = await fetch(
      'https://gopang-proxy.tensor-city.workers.dev/auth/webauthn/challenge',
      { credentials: 'include' }
    );
    const { challenge, exp, sig: chalSig } = await chalRes.json();

    // 2. WebAuthn 등록
    const challengeBytes = Uint8Array.from(
      atob(challenge.replace(/-/g,'+').replace(/_/g,'/')),
      c => c.charCodeAt(0)
    );

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge:              challengeBytes,
        rp: {
          id:   'gopang.net',
          name: '고팡 (Gopang)',
        },
        user: {
          id:          new TextEncoder().encode(ipv6),
          name:        ipv6,
          displayName: '고팡 사용자',
        },
        pubKeyCredParams: [
          { alg: -7,   type: 'public-key' },   // ES256 (ECDSA)
          { alg: -257, type: 'public-key' },   // RS256 (RSA)
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // 기기 내장 (지문/Face ID)
          userVerification:        'required',  // 반드시 생체 확인
          residentKey:             'preferred',
        },
        timeout: 60000,
        attestation: 'none',   // 기기 모델 정보 불필요
      },
    });

    // 3. 공개키 추출
    const credId    = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const publicKey = btoa(String.fromCharCode(
      ...new Uint8Array(credential.response.getPublicKey
        ? credential.response.getPublicKey()
        : credential.response.attestationObject)
    )).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

    // 4. Worker에 공개키 저장 (Supabase)
    const regRes = await fetch(
      'https://gopang-proxy.tensor-city.workers.dev/auth/webauthn/register',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ipv6,
          credentialId:  credId,
          publicKey,
          challenge,
          challengeExp:  exp,
          challengeSig:  chalSig,
          deviceType:    'platform',
        }),
      }
    );
    const regData = await regRes.json();

    if (!regData.ok) throw new Error(regData.error || '등록 실패');

    // 5. localStorage에 credential ID 저장 (L2 승격)
    const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || '{}');
    const updated = {
      ...stored,
      authLevel: 'L2',
      webauthn: {
        credentialId: credId,
        registeredAt: new Date().toISOString(),
      },
      lastSeenAt: new Date().toISOString(),
    };
    localStorage.setItem('gopang_user_v3', JSON.stringify(updated));

    appendBubble('ai',
      `✅ 지문 등록 완료! 인증 레벨 <b>L2</b> 달성.<br><br>` +
      `이제 중요한 거래 시 지문으로 추가 인증합니다.<br>` +
      `<small style="color:var(--label-3);">` +
      `L0 기기인증 · L1 얼굴인증 · L2 지문인증 · L3 시드인증</small>`,
      true
    );

  } catch(e) {
    if (e.name === 'NotAllowedError') {
      appendBubble('ai', '지문 인증이 취소됐습니다. 나중에 설정에서 등록할 수 있습니다.', true);
    } else {
      appendBubble('ai', `지문 등록 오류: ${e.message}`, true);
    }
    console.warn('[WebAuthn] 등록 실패:', e.name, e.message);
  }
};

window._skipFingerprint = function() {
  document.getElementById('_fp-btns')?.remove();
  appendBubble('ai',
    '지문 등록을 건너뛰었습니다.<br>' +
    '설정 → 보안에서 나중에 등록할 수 있습니다.',
    true
  );
};

// ── 기기 변경 복원 UI ────────────────────────────────────
function _showRestoreUI(stored, newFpHex, newIpv6) {
  setTimeout(() => {
    appendBubble('ai',
      '📱 새 기기 또는 앱 갱신이 감지됐습니다.<br><br>' +
      '이전 정체성을 복원하려면:<br>' +
      '1️⃣ 등록 시 설정한 <b>4단어 시드</b> 입력<br>' +
      '2️⃣ <b>얼굴 인증</b> (선택 — 더 빠른 복원)<br><br>' +
      '아래에 4단어를 입력하세요.',
      true
    );
    _showRestoreInputUI(stored, newFpHex);
  }, 800);
}

function _showRestoreInputUI(stored, newFpHex) {
  const list = document.getElementById('message-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.innerHTML = `
    <div style="background:var(--bg-subtle);border-radius:12px;
                padding:16px;width:100%;max-width:320px;">
      <input id="_restore-seed" type="text"
        placeholder="등록 시 입력한 단어 4개"
        style="width:100%;padding:10px 12px;border-radius:8px;
               border:1px solid var(--sep-strong);font-size:14px;
               background:var(--bg);color:var(--label);
               box-sizing:border-box;margin-bottom:10px;"/>
      <button onclick="_verifyRestore('${newFpHex}')"
        style="width:100%;background:var(--tint);color:#fff;border:none;
               border-radius:8px;padding:11px;font-size:14px;
               font-weight:600;cursor:pointer;">
        복원하기
      </button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

window._verifyRestore = async function(newFpHex) {
  const words    = document.getElementById('_restore-seed')?.value?.trim() || '';
  const stored   = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');

  if (!stored?.seedHex) {
    appendBubble('ai', '⚠️ 이전 등록 정보가 없습니다. 새로 등록해 주세요.', true);
    return;
  }

  // 입력한 4단어 → PBKDF2 → 저장된 seedHex와 비교
  const inputBytes = await _seedToBytes(words);
  const inputHex   = Array.from(inputBytes).map(b=>b.toString(16).padStart(2,'0')).join('');

  if (inputHex !== stored.seedHex) {
    appendBubble('ai', '❌ 시드가 일치하지 않습니다. 다시 확인해 주세요.', true);
    return;
  }

  // ✅ 시드 일치 → 기기 핑거프린트 갱신 후 복원
  const newIpv6 = await _buildIPv6Identity(newFpHex);
  const updated = {
    ...stored,
    fpHex:      newFpHex,
    ipv6:       stored.ipv6,   // IPv6 정체성 유지 (변경 안 함)
    lastSeenAt: new Date().toISOString(),
  };
  localStorage.setItem('gopang_user_v3', JSON.stringify(updated));
  _upsertUserRecord(updated);

  document.querySelectorAll('.msg-row.ai').forEach(el => {
    if (el.querySelector('#_restore-seed')) el.remove();
  });

  appendBubble('ai',
    `✅ 복원 완료!<br><br>` +
    `🆔 <code style="font-size:11px;">${stored.ipv6}</code><br>` +
    `이전 정체성이 이 기기에 연결됐습니다.`,
    true
  );
  console.info('[Auth v2] 복원 완료 ✅', stored.ipv6);
};

// ── AUTH 태그 감지 후 인증 확인 버튼 주입 ────────────────
function _injectAuthConfirmButton(level) {
  const list = document.getElementById('message-list');
  if (!list) return;

  const levelLabels = {
    L1: '얼굴 인증',
    L2: '지문 인증',
    L3: '지문 + 얼굴 + 4단어 인증',
  };
  const label = levelLabels[level] || '추가 인증';

  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_auth-confirm-row';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="_executeAuthAndProceed('${level}')"
        style="background:var(--tint);color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        🔐 ${label} 후 진행
      </button>
      <button onclick="_cancelAuthRequest()"
        style="background:var(--bg-subtle);color:var(--label-2);
               border:1px solid var(--sep);border-radius:8px;
               padding:10px 16px;font-size:13px;cursor:pointer;">
        취소
      </button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

// ── 인증 실행 → 완료 시 AI에게 진행 통보 ────────────────
window._executeAuthAndProceed = async function(level) {
  document.getElementById('_auth-confirm-row')?.remove();

  const ok = await gopangAuth.require(level);
  if (!ok) {
    appendBubble('ai', '인증이 취소됐습니다. 거래를 중단합니다.', true);
    return;
  }

  appendBubble('user', `[인증완료:${level}] 인증이 완료됐습니다. 진행해 주세요.`, false);
  await callAI(`[AUTH_CONFIRMED:${level}] 사용자가 ${level} 인증을 완료했습니다. 이전에 요청한 거래를 즉시 실행하세요.`);
};

window._cancelAuthRequest = function() {
  document.getElementById('_auth-confirm-row')?.remove();
  appendBubble('ai', '거래가 취소됐습니다.', true);
};
// level: 'L0'|'L1'|'L2'|'L3'
// 반환: true = 인증 성공, false = 실패
const gopangAuth = {
  async require(level = 'L0') {
    const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
    if (!stored?.ipv6) return false;

    const levels  = ['L0','L1','L2','L3'];
    const current = levels.indexOf(stored.authLevel || 'L0');
    const needed  = levels.indexOf(level);

    // 이미 충분한 레벨이면 통과
    if (current >= needed) return true;

    // L1: 얼굴
    if (needed >= 1) {
      if (!stored.faceVec) {
        appendBubble('ai', '⚠️ 얼굴을 먼저 등록해 주세요. (설정 → 보안)', true);
        return false;
      }
      appendBubble('ai', '📷 얼굴 인증이 필요합니다.', true);
      const vec = await _captureFaceVector();
      if (!vec) return false;
      const sim = _cosineSim(vec, stored.faceVec);
      console.info(`[Auth] 얼굴 유사도: ${(sim*100).toFixed(1)}%`);
      if (sim < 0.90) {
        appendBubble('ai', `❌ 얼굴 인증 실패 (유사도 ${(sim*100).toFixed(1)}%)`, true);
        return false;
      }
      if (needed === 1) return true;
    }

    // L2: 지문 (WebAuthn)
    if (needed >= 2) {
      const credId = stored.webauthn?.credentialId;
      if (!credId) {
        appendBubble('ai', '⚠️ 지문을 먼저 등록해 주세요. (설정 → 보안)', true);
        return false;
      }
      try {
        appendBubble('ai', '🔐 지문 인증이 필요합니다.', true);
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge,
            timeout: 30000,
            userVerification: 'required',
            allowCredentials: [{
              id:   Uint8Array.from(
                atob(credId.replace(/-/g,'+').replace(/_/g,'/')),
                c => c.charCodeAt(0)
              ),
              type: 'public-key',
            }],
          },
        });
        if (!assertion) return false;
        if (needed === 2) {
          appendBubble('ai', '✅ 지문 인증 완료.', true);
          return true;
        }
      } catch(e) {
        appendBubble('ai', '지문 인증이 취소됐습니다.', true);
        return false;
      }
    }

    // L3: + 4단어
    if (needed >= 3) {
      const words = prompt('4단어 시드를 입력하세요:');
      if (!words) return false;
      const inputBytes = await _seedToBytes(words);
      const inputHex   = Array.from(inputBytes)
        .map(b=>b.toString(16).padStart(2,'0')).join('');
      if (inputHex !== stored.seedHex) {
        appendBubble('ai', '❌ 시드가 일치하지 않습니다.', true);
        return false;
      }
      appendBubble('ai', '✅ L3 전체 인증 완료.', true);
      return true;
    }

    return false;
  }
};
// 하위 호환
window.gopangAuth = gopangAuth;

// ── 설정 ────────────────────────────────────────────────
const CFG = {
  apiKey:    'sk-e4a6f005aecf43d4aa60e77bb71de14c',   // DeepSeek API Key (하드코딩)
  geminiKey: 'AIzaSyDiytKUg_0MJVBM3gFYzTms7mO6Y2mhLT4',   // Gemini Vision API Key (하드코딩)
  kakaoKey:  '66648ca49f126d8752b33d542789ac56',   // 카카오 REST API Key (역지오코딩 — GPS→주소 변환용)
  endpoint:  'https://gopang-proxy.tensor-city.workers.dev',
  model:     'deepseek-v4-flash',   // ✅ V4 Flash — V4 Pro 대비 12배 저렴, 일상 대화·라우팅 충분
  system:   `# AI Secretary Prompt SP-00 v10.0
# 문서코드: SP-00 | 작성: AI City Inc. · 도영민
# 사용자 GUID: ${USER_GUID}

## § 0. 정체성
나는 고팡(Gopang) AI 비서다.
사용자의 지시를 듣고 두 가지 중 하나를 즉시 결정한다.
  A) 내가 직접 처리한다.
  B) 전문 하위 시스템을 호출한다 → 응답에 [GWP:서비스ID] 태그를 출력한다.
없는 사실 꾸미기·허위 완료 선언 = 자격 박탈.

## § 1. 판단 원칙 — 매 지시마다 내부적으로 실행

[THINK]
① 사용자가 진짜로 원하는 것이 무엇인가?
② 아래 § 2 하위 시스템 중 담당 서비스가 있는가?
   → 있으면: 즉시 [GWP:서비스ID] 태그 출력 후 간단한 안내 한 줄
   → 없으면: 내가 직접 처리 (질문 답변, 계산, 검색, 분석 등)
③ 직접 처리 시 웹 검색이 필요한가?
[/THINK]

## § 2. 고팡 하위 시스템 — 16개

[GWP:kemergency]  K-Emergency  — 긴급·응급·119·화재·구조·사고·심정지·재난
[GWP:klaw]        K-Law        — 법률·소송·계약서·판결·고소·변호사·분쟁
[GWP:kpolice]     K-Police     — 경찰·범죄신고·도둑·강도·폭행·스토킹·보이스피싱
[GWP:ksecurity]   K-Security   — 해킹·랜섬웨어·개인정보침해·사이버보안·계정탈취
[GWP:khealth]     K-Health     — 병원·증상·처방·진단·의료·건강검진·수술
[GWP:kedu]        K-School     — 교육·학습·입시·과외·논문·특허·자격증·진로
[GWP:kgdc]        GDC          — GDC 잔액·이체·환전·대출·고팡 화폐
[GWP:kfinance]    K-Stock      — 주식·투자·포트폴리오·ETF·펀드·증권·자산관리
[GWP:kinsurance]  K-Insurance  — 보험·보상·청구·실손·생명보험·자동차보험·화재보험
[GWP:ktax]        K-Tax        — 세금·세무·납부·환급·절세·부가세·소득세·재무제표
[GWP:kcommerce]   K-Market     — 주문·배달·음식·쇼핑·구매·예약·맛집·근처·시켜·추천
[GWP:ktransport]  K-Traffic    — 교통·버스·지하철·택시·길찾기·경로·내비·주차
[GWP:klogistics]  K-Logistics  — 택배·배송·물류·운송·화물·발송·추적
[GWP:fiil-kcleaner] K-Cleaner — 쓰레기·환경오염·불법투기·해양·청소·수거·신고
[GWP:kgov]        K-Gov        — 민원·등본·허가·면허·행정심판·정부·관공서
[GWP:kdemocracy]  K-Democracy  — 투표·안건·청원·고팡 의회·직접민주주의

## § 3. [GWP] 태그 출력 규칙

- 하위 시스템 해당 시: 응답 첫 줄에 [GWP:서비스ID] 를 반드시 출력한다.
- 태그 뒤에 한 줄 안내를 덧붙인다. 길게 설명하지 않는다.
- 시스템이 태그를 감지해 자동으로 새 탭을 연다. 직접 URL을 출력하지 않는다.
- 긴급(kemergency) 판단 시: 다른 고려 없이 즉시 [GWP:kemergency] 출력.

예시:
  사용자: "짜장면 한 그릇 시켜 줘"
  → [GWP:kcommerce] K-Market에서 주문을 도와드립니다.

  사용자: "어깨가 너무 아파요"
  → [GWP:khealth] K-Health에서 증상을 확인해 드립니다.

  사용자: "불이야!"
  → [GWP:kemergency] 긴급 상황을 감지했습니다. K-Emergency에 연결합니다.

  사용자: "보험 청구하고 싶어요"
  → [GWP:kinsurance] K-Insurance에서 청구 절차를 안내해 드립니다.

  사용자: "오늘 날씨 어때?"
  → (태그 없이 직접 답변) 현재 위치 기준 날씨를 알려드립니다.

## § 4. 직접 처리 범위
하위 시스템에 해당하지 않는 모든 것은 내가 직접 처리한다.
- 일반 질문·계산·번역·요약·분석
- 날씨·시간·위치 확인
- 일상 대화·조언·창작
- 웹 검색이 필요한 정보 조회 (🌐 검색 중 명시)
- PDV 조회·IoT 기기 제어

## § 5. 세계관
한국의 모든 사람·기관·사물은 고팡 사용자이며 각자 AI 비서를 보유한다.
[사람] 모든 개인 | [기관] 특허청·법원·병원·은행·음식점 등 | [사물] 차량(VIN)·냉장고·세탁기(시리얼)

## § 6. PDV 자율 인출
사용자 정보는 PDV에서 직접 인출. 정보 요청 금지.
예외(이때만 확인): PDV 정보 없음 / 50만원↑ 승인 / 법적 계약 / 되돌릴 수 없는 행위
허위 금지: PDV 없는 데이터·없는 AI 연결·검색 없이 결과 조작 절대 금지.

## § 7. 인증 레벨 — 행위 실행 전 판단
인증이 필요하면 [GWP] 태그보다 먼저 [AUTH:Lx] 태그를 출력한다.

[AUTH:L3] 지문+얼굴+4단어 — 1,000만원↑ 송금·계약·부동산·정체성 변경
[AUTH:L2] 지문           — 10만원↑ 금융거래·계약서 서명·타인 송금
[AUTH:L1] 얼굴           — 10만원↓ 결제·PDV 직접 열람·공식 문서 발송
[AUTH:L0] 자동           — 정보 조회·일반 대화·계산·위치 확인

예시:
  "김철수 계좌로 500만원 보내줘" → [AUTH:L2] 지문 인증이 필요합니다.
  "내일 날씨 알려줘"             → (인증 태그 없이 바로 답변)

## § 8. 응답 형식
- 위치 정보: 시스템이 주입한 [현재 위치]만 사용. 임의 추정 금지.
- 결제: 5만↓자동 | 5~50만 5초후자동 | 50만↑명시승인
- 서명: ✍️ ECDSA P-256 (공식 요청·계약 시)
- 언어: 한국어, 간결·명확
- PDV 기록: 대화 종료 시 자동 저장 (매 응답마다 출력 불필요)`,

};

let aiActive   = false;
let micActive  = false;
let attachFile = null;
let recognition = null;
const history  = [];   // { role, content }

// ── 대화 저장 — 세션 종료 시 단 1회 실행 ────────────────────
// 저장 키: gopang_history_{GUID}_{날짜}
// 분류: 인간 활동 12대 영역 코드 자동 태깅
const DOMAIN_PATTERNS = {
  ECO: /금융|투자|세금|결제|송금|보험|연금|대출|환율|주식|가계부/,
  MED: /병원|의사|약|진료|처방|응급|건강|수술|의료|코로나|백신/,
  EDU: /학교|강의|시험|특허|논문|학습|교육|수업|입학|졸업/,
  TRN: /배달|택배|교통|버스|지하철|택시|운전|물류|배송|주차/,
  MKT: /구매|쇼핑|거래|계약|부동산|임대|판매|상품|가격|주문/,
  GOV: /민원|등본|신고|행정|정부|공공|허가|면허|신청|공무원/,
  JUS: /법|소송|재판|경찰|변호사|판결|고소|계약서|법원|범죄/,
  IND: /제조|건설|농업|공장|생산|설비|작업|현장|제품|원자재/,
  ENV: /환경|에너지|재활용|기후|탄소|오염|태양광|전기|가스|수도/,
  CUL: /여행|관광|스포츠|영화|음악|게임|식당|카페|취미|문화/,
  SOC: /복지|고용|실업|육아|노인|장애|사회보험|지원금|봉사/,
  IOT: /냉장고|세탁기|에어컨|차량|스마트홈|IoT|사물|기기|센서/,
};

function _classifyDomain(text) {
  for (const [code, re] of Object.entries(DOMAIN_PATTERNS)) {
    if (re.test(text)) return code;
  }
  return 'ETC';
}

function _saveSessionOnce() {
  if (history.length < 2) return;  // 의미 있는 대화가 없으면 저장 안 함

  // 전체 대화에서 도메인 빈도 집계
  const domainCount = {};
  for (const msg of history) {
    const d = _classifyDomain(String(msg.content));
    domainCount[d] = (domainCount[d] || 0) + 1;
  }
  const primaryDomain = Object.entries(domainCount).sort((a,b)=>b[1]-a[1])[0][0];

  const today = new Date().toISOString().slice(0,10);  // "2026-05-23"
  const key   = `gopang_history_${USER_GUID}_${today}`;

  try {
    // 당일 기존 저장분이 있으면 append, 없으면 새로 생성
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({
      ts:      new Date().toISOString(),
      domain:  primaryDomain,
      turns:   history.length,
      summary: history.slice(-4),   // 마지막 4턴만 저장 (프라이버시 최소화)
    });
    localStorage.setItem(key, JSON.stringify(existing));
    console.log(`[Session] 대화 저장 완료 — 영역: ${primaryDomain}, 턴: ${history.length}`);
  } catch(e) {
    console.warn('[Session] 저장 실패:', e.message);
  }
}

// 탭/앱이 숨겨지거나(pagehide) visibility 변경될 때 단회 저장
let _sessionSaved = false;
function _saveOnce() {
  if (_sessionSaved) return;
  _sessionSaved = true;
  _saveSessionOnce();
}
window.addEventListener('pagehide',         _saveOnce);
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _saveOnce(); });

// ── 부트스트랩 연동 ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const { bootstrap } = await import('./src/app.js');
    await bootstrap();
    document.getElementById('status-dot').style.background = 'var(--green)';
  } catch(e) {
    document.getElementById('status-text').textContent = '오프라인 모드';
    document.getElementById('status-dot').style.background = 'var(--yellow)';
    console.warn('[UI] 고팡 백엔드 없이 AI 전용 모드:', e.message);
  }
  loadSettings();

  // ── 초기 AI 비서 메시지 ───────────────────────────────
  _showWelcomeMessage();
  // localStorage에 남은 구버전 모델명을 즉시 교정
  if (MODEL_MIGRATION[CFG.model]) {
    CFG.model = MODEL_MIGRATION[CFG.model];
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.model = CFG.model;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
  }
  showGUID();
  _scheduleLocation();  // GPS — PWA 배너 충돌 방지 지연 실행
});

// ── 위치 획득 (GPS 실제 좌표 우선) ──────────────────────────
// 원칙:
//   1순위: GPS 실제 좌표 (navigator.geolocation)
//   2순위: PDV 프로필에 저장된 주소
//   절대 금지: 임의로 도시 추정 ("서울" "역삼동" 등 가정 금지)
//
// 충돌 방지 원칙:
//   - PWA 설치 배너(beforeinstallprompt)와 GPS 권한 요청이 동시에 뜨면
//     Android Chrome이 두 번째 다이얼로그를 차단함
//   - 해결: GPS 요청을 PWA 배너 해소 후 OR 첫 메시지 전송 시로 지연
let _userLocation    = null;   // { lat, lng, address, source }
let _locationReady   = false;  // GPS 요청이 완료됐는지 여부
let _locationPending = false;  // GPS 요청이 진행 중인지 여부

// ── GPS 지연 스케줄러 (PWA 배너와 충돌 방지) ────────────────
