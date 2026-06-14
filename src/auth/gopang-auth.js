// gopang-auth.js — 인증 헬퍼(MediaPipe·카메라·지문·시드·등록·복구)
async function _loadMediaPipe() {
  if (_mpFaceLandmarker) return _mpFaceLandmarker;
  if (_mpLoading) {
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
async function _extractFaceVector(imageEl) {
  const lm = _mpFaceLandmarker;
  if (!lm) return null;
  const result = lm.detect(imageEl);
  if (!result.faceLandmarks?.length) return null;
  const pts = result.faceLandmarks[0];

  const nose  = pts[1];
  const scale = Math.hypot(
    pts[33].x - pts[263].x,
    pts[33].y - pts[263].y
  ) || 1;

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

// ── 전면 카메라 UI ──────────────────────────────────────
function _showFaceCaptureUI(onCapture) {
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
                  border:3px solid rgba(22,163,74,0.8);pointer-events:none;"></div>
    </div>
    <div id="_face-error" style="display:none;background:rgba(239,68,68,0.08);
         border:1px solid rgba(239,68,68,0.3);border-radius:10px;
         padding:12px 16px;text-align:center;max-width:280px;">
      <p style="color:#dc2626;font-size:13px;margin:0 0 8px;line-height:1.5;"></p>
      <button id="_face-retry-btn"
        style="background:#16a34a;color:#fff;border:none;border-radius:6px;
               padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;">
        다시 시도
      </button>
    </div>
    <button id="_face-snap-btn" disabled
      style="background:#16a34a;color:#fff;border:none;border-radius:8px;
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
    if (errMsg)  errMsg.textContent   = msg;
    if (errBox)  errBox.style.display = 'block';
    if (snapBtn) { snapBtn.disabled = true; snapBtn.style.opacity = '0.4'; }
    if (guide)   guide.textContent   = '카메라 권한이 필요합니다';
  };

  const _startCamera = (constraints) => {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(s => {
        stream = s;
        const v     = document.getElementById('_face-video');
        const btn   = document.getElementById('_face-snap-btn');
        const guide = document.getElementById('_face-guide');
        if (v)     v.srcObject = s;
        if (btn)   { btn.disabled = false; btn.style.opacity = '1'; }
        if (guide) guide.textContent = '얼굴을 원 안에 맞추고 촬영하세요';
      })
      .catch(err => {
        console.warn('[FaceCapture] 카메라 실패:', err.name, err.message);
        if (constraints.video?.width && err.name !== 'NotAllowedError') {
          _startCamera({ video: { facingMode: 'user' } });
          return;
        }
        if (err.name === 'NotAllowedError') {
          _showError('카메라 권한이 거부됐습니다.\n설정에서 카메라를 허용해 주세요.');
        } else if (err.name === 'NotFoundError') {
          _showError('전면 카메라를 찾을 수 없습니다.');
        } else if (err.name === 'NotReadableError') {
          _showError('카메라가 다른 앱에서 사용 중입니다.');
        } else {
          _showError(`카메라 오류: ${err.message}`);
        }
      });
  };

  _startCamera({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } } });

  document.getElementById('_face-retry-btn').onclick = () => {
    const errBox = document.getElementById('_face-error');
    if (errBox) errBox.style.display = 'none';
    _startCamera({ video: { facingMode: 'user' } });
  };

  document.getElementById('_face-snap-btn').onclick = () => {
    const v = document.getElementById('_face-video');
    if (!v || !stream) { _stop(); onCapture(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width  = v.videoWidth  || 640;
    canvas.height = v.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    _stop();
    onCapture(canvas.toDataURL('image/jpeg', 0.85));
  };

  document.getElementById('_face-cancel-btn').onclick = () => {
    _stop(); onCapture(null);
  };
}

// ── 4단어 시드 → IPv6 형식 GUID [v2.0] ─────────────────
// 4단어 → PBKDF2(100,000회) → 128비트 → IPv6
async function _seedToGUID(words) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(words.trim().toLowerCase()),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2',
      salt: new TextEncoder().encode('gopang-v2-salt'),
      iterations: 100000,
      hash: 'SHA-256' },
    key, 128  // 16바이트 = IPv6 128비트
  );
  const hex = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2,'0')).join('');

  // IPv6 형식 변환 + 고팡 prefix
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(hex.slice(i*4, i*4+4));
  groups[0] = '2601';
  groups[1] = 'db80';
  return groups.join(':');
}

// ── 4단어 시드 → 32바이트 마스터 시드 (L3 인증용) ──────
async function _seedToBytes(words4) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(words4.trim().toLowerCase()),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2',
      salt: new TextEncoder().encode('gopang-v2-salt'),
      iterations: 100000,
      hash: 'SHA-256' },
    key, 256
  );
  return new Uint8Array(bits);
}
