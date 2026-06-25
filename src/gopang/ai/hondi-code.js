/**
 * hondi-code.js — 혼디 시각 코드 인코더 / 디코더
 *
 * 9가지 색상으로 short_id를 인코딩합니다.
 *
 * 색상 팔레트 (인덱스 0~8):
 *   0 = 무색(흰색)  RGB(255,255,255)
 *   1 = 빨강        RGB(220,  0,  0)
 *   2 = 주황        RGB(255,140,  0)
 *   3 = 노랑        RGB(255,220,  0)
 *   4 = 초록        RGB(  0,180,  0)
 *   5 = 파랑        RGB(  0,  0,220)
 *   6 = 남색        RGB(  0,  0,128)
 *   7 = 보라        RGB(128,  0,128)
 *   8 = 흑색        RGB(  0,  0,  0)
 *
 * 버전:
 *   v1 — 10칸 단열  (9^10 ≈ 34억)
 *   v2 — 20칸 복열  (9^20 ≈ 1.2×10^19)
 *
 * 버전 판별:
 *   "ㄷ" 단색 흑색         → v1
 *   "ㄷ" 흑색+회색 복합색  → v2
 */

// ── 색상 팔레트 ────────────────────────────────────────────────
export const PALETTE = [
  { idx: 0, name: '무색', r: 255, g: 255, b: 255 },
  { idx: 1, name: '빨강', r: 220, g:   0, b:   0 },
  { idx: 2, name: '주황', r: 255, g: 100, b:   0 },  // 노랑과 거리 확보 (80→135)
  { idx: 3, name: '노랑', r: 255, g: 235, b:   0 },  // 주황과 거리 확보
  { idx: 4, name: '초록', r:   0, g: 180, b:   0 },
  { idx: 5, name: '파랑', r:   0, g:   0, b: 220 },
  { idx: 6, name: '남색', r:   0, g:   0, b: 100 },  // 파랑·흑색과 거리 확보
  { idx: 7, name: '보라', r: 150, g:   0, b: 150 },  // 더 선명한 보라
  { idx: 8, name: '흑색', r:   0, g:   0, b:   0 },
];

// ── 캘리브레이션 기준색 ────────────────────────────────────────
// 각 글자 자모의 설계 기준 RGB
export const CALIB_REF = {
  bg:  { r: 255, g: 255, b: 255 },  // 배경 흰색
  hih: { r:   0, g:   0, b: 220 },  // ㅎ 파랑
  ho:  { r: 220, g:   0, b:   0 },  // ㅗ 빨강
  n:   { r:   0, g:   0, b:   0 },  // ㄴ 검정
  d:   { r:   0, g:   0, b:   0 },  // ㄷ 검정(v1 기준)
};

// ── 버전 판별 ─────────────────────────────────────────────────
// ㄷ 영역에서 샘플링한 색상 배열로 v1/v2 판별
// v1: 모든 샘플이 거의 흑색 (단색)
// v2: 흑색과 회색이 섞임 (복합색)
export function detectVersion(dSamples) {
  // dSamples: [{r,g,b}, ...] — ㄷ 영역 샘플 픽셀들
  const GRAY_THRESHOLD = 80;   // 이 밝기 이상이면 "회색"으로 판단
  const GRAY_RATIO = 0.15;     // 15% 이상이 회색이면 v2

  const grayCount = dSamples.filter(p => {
    const brightness = (p.r + p.g + p.b) / 3;
    // 채도가 낮고(회색계열) 밝기가 중간인 픽셀
    const maxC = Math.max(p.r, p.g, p.b);
    const minC = Math.min(p.r, p.g, p.b);
    const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
    return saturation < 0.2 && brightness > GRAY_THRESHOLD && brightness < 200;
  }).length;

  const ratio = grayCount / dSamples.length;
  return ratio >= GRAY_RATIO ? 'v2' : 'v1';
}

// ── 색상 보정 (캘리브레이션 적용) ────────────────────────────
// measured: 측정된 기준점 RGB
// 보정 계수를 채널별로 산출하여 데이터 픽셀에 적용
export function buildCalibMatrix(measured) {
  // measured: { bg, hih, ho, n }
  return {
    rScale: CALIB_REF.ho.r  / Math.max(1, measured.ho.r),
    gScale: CALIB_REF.bg.g  / Math.max(1, measured.bg.g),
    bScale: CALIB_REF.hih.b / Math.max(1, measured.hih.b),
    darkOffset: measured.n.r,  // 암부 오프셋
  };
}

export function applyCalib(pixel, matrix) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return {
    r: clamp((pixel.r - matrix.darkOffset) * matrix.rScale),
    g: clamp((pixel.g - matrix.darkOffset) * matrix.gScale),
    b: clamp((pixel.b - matrix.darkOffset) * matrix.bScale),
  };
}

// ── 색상 → 팔레트 인덱스 ─────────────────────────────────────
// 보정된 픽셀과 팔레트 9색 중 유클리드 거리 최소 항목 선택
export function rgbToIndex(pixel) {
  let minDist = Infinity, best = 0;
  for (const c of PALETTE) {
    const dr = pixel.r - c.r;
    const dg = pixel.g - c.g;
    const db = pixel.b - c.b;
    const dist = dr*dr + dg*dg + db*db;
    if (dist < minDist) { minDist = dist; best = c.idx; }
  }
  return best;
}

// ── 인덱스 배열 → short_id (BigInt) ──────────────────────────
// indices: [0~8, ...] 길이 10(v1) 또는 20(v2)
export function indicesToId(indices) {
  let id = 0n;
  for (const idx of indices) {
    id = id * 9n + BigInt(idx);
  }
  return id;
}

// ── short_id (BigInt) → 인덱스 배열 ──────────────────────────
export function idToIndices(id, version = 'v1') {
  const len = version === 'v2' ? 20 : 10;
  const result = new Array(len).fill(0);
  let n = BigInt(id);
  for (let i = len - 1; i >= 0; i--) {
    result[i] = Number(n % 9n);
    n = n / 9n;
  }
  return result;
}

// ── 인덱스 → RGB ──────────────────────────────────────────────
export function indexToRgb(idx) {
  const c = PALETTE[idx];
  return { r: c.r, g: c.g, b: c.b };
}

// ── 정보량 상수 ───────────────────────────────────────────────
export const MAX_V1 = 9n ** 10n;   // 3,486,784,401
export const MAX_V2 = 9n ** 20n;   // 12,157,665,459,056,928,801

// ── 유틸: short_id ↔ 표시용 문자열 ──────────────────────────
// 9진법 문자열로 표현 (디버그·인쇄용)
export function idToBase9String(id, version = 'v1') {
  const indices = idToIndices(id, version);
  return indices.join('');
}

export function base9StringToId(str) {
  let id = 0n;
  for (const ch of str) {
    id = id * 9n + BigInt(parseInt(ch, 10));
  }
  return id;
}

// ── GUID → short_id (가입 시점 색상 코드 생성용) ──────────────
// guid: "2601:db80:xxxx:xxxx:..." 형태의 IPv6 문자열(콜론 포함).
// 결정적(deterministic) 변환 — 같은 guid는 항상 같은 short_id를 만들어내므로
// 서버에 별도 저장 없이도 클라이언트가 언제든 동일한 코드를 재생성할 수 있다.
export function guidToShortId(guid, version = 'v1') {
  const hex = guid.replace(/:/g, '');
  const big = BigInt('0x' + hex);
  const max = version === 'v2' ? MAX_V2 : MAX_V1;
  return big % max;
}

// ── 캔버스 기반 "혼디" 코드 이미지 생성기 ─────────────────────
// hondi-scanner.js의 _detectHondiROI 비율(ㅎ/ㅗ/ㄴ/ㄷ/ㅣ)과 동일한 비율
// 상수를 사용한다 — 생성된 이미지가 스캐너로 다시 인식 가능해야 하기 때문.
// 브라우저 환경(document 필요)에서만 동작한다.
export function generateHondiCodeCanvas(shortId, version = 'v1') {
  const gW = 400, gH = 222;   // aspect ≈ 1.8 (ASPECT_MIN 1.4 ~ ASPECT_MAX 3.5 이내)
  const PAD = 24;
  const W = gW + PAD * 2, H = gH + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(PAD, PAD);

  const BLUE = 'rgb(0,0,220)', RED = 'rgb(220,0,0)', BLACK = 'rgb(0,0,0)', GRAY = 'rgb(140,140,140)';

  // ㅎ ROI: x0,y0, gW*0.38, gH*0.38
  const hihW = gW * 0.38, hihH = gH * 0.38;
  ctx.fillStyle = BLUE;
  ctx.fillRect(hihW * 0.10, hihH * 0.05, hihW * 0.80, hihH * 0.30);   // 가로획
  ctx.fillRect(hihW * 0.38, -hihH * 0.30, hihW * 0.24, hihH * 0.35);  // 위로 돌출
  ctx.lineWidth = hihH * 0.30;
  ctx.strokeStyle = BLUE;
  ctx.beginPath();
  ctx.ellipse(hihW * 0.50, hihH * 0.72, hihW * 0.34, hihH * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();

  // ㅗ ROI: x=gW*0.08, y=gH*0.30, w=gW*0.28, h=gH*0.20 (원으로 채움)
  const hoX = gW * 0.08 + gW * 0.14, hoY = gH * 0.30 + gH * 0.10;
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(hoX, hoY, Math.min(gW * 0.14, gH * 0.10), 0, Math.PI * 2);
  ctx.fill();

  // ㄴ ROI: x0,y=gH*0.72,w=gW*0.38,h=gH*0.20
  const nY = gH * 0.72, nH = gH * 0.20, nW = gW * 0.38;
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, nY, nW * 0.26, nH);
  ctx.fillRect(0, nY + nH - nH * 0.30, nW, nH * 0.30);

  // ㄷ ROI: x=midX, y=gH*0.08, w=gW*0.38, h=gH*0.70 (오른쪽이 열린 형태)
  const midX = gW * 0.52;
  const dX = midX, dY = gH * 0.08, dW = gW * 0.38, dH = gH * 0.70;
  const dStroke = dH * 0.16;
  ctx.fillStyle = BLACK;
  ctx.fillRect(dX, dY, dW, dStroke);                       // 위
  ctx.fillRect(dX, dY, dStroke, dH);                        // 좌측
  ctx.fillRect(dX, dY + dH - dStroke, dW, dStroke);         // 아래
  if (version === 'v2') {
    // v2 신호 — ㄷ 아래쪽 일부를 회색으로 (detectVersion이 읽는 부분)
    ctx.fillStyle = GRAY;
    ctx.fillRect(dX, dY + dH - dStroke, dW * 0.5, dStroke);
  }

  // ㅣ ROI: x=midX+gW*0.32, y=0, w=gW*0.13, h=gH → 색상 코드 칸
  // 칸 순서는 idToIndices와 동일: 배열 첫 원소(최상위 자릿수)가 맨 위 칸.
  const iX = midX + gW * 0.32, iY = 0, iW = gW * 0.13, iH = gH;
  const indices = idToIndices(BigInt(shortId), version);
  const ROWS = 10;
  const cellH = iH / ROWS;

  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;

  if (version === 'v1') {
    for (let row = 0; row < ROWS; row++) {
      const c = PALETTE[indices[row]];
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.fillRect(iX, iY + row * cellH, iW, cellH);
      ctx.strokeRect(iX, iY + row * cellH, iW, cellH);
    }
  } else {
    const halfW = iW / 2;
    for (let row = 0; row < ROWS; row++) {
      const y = iY + row * cellH;
      const cL = PALETTE[indices[row * 2]];
      const cR = PALETTE[indices[row * 2 + 1]];
      ctx.fillStyle = `rgb(${cL.r},${cL.g},${cL.b})`;
      ctx.fillRect(iX, y, halfW, cellH);
      ctx.fillStyle = `rgb(${cR.r},${cR.g},${cR.b})`;
      ctx.fillRect(iX + halfW, y, halfW, cellH);
      ctx.strokeRect(iX, y, iW, cellH);
    }
  }

  return canvas;
}

// 가입·설정 화면에서 바로 쓰는 편의 함수 — data URL(PNG) 반환
export function generateHondiCodeDataURL(shortId, version = 'v1') {
  return generateHondiCodeCanvas(shortId, version).toDataURL('image/png');
}
