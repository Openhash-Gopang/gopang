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
  { idx: 2, name: '주황', r: 255, g: 140, b:   0 },
  { idx: 3, name: '노랑', r: 255, g: 220, b:   0 },
  { idx: 4, name: '초록', r:   0, g: 180, b:   0 },
  { idx: 5, name: '파랑', r:   0, g:   0, b: 220 },
  { idx: 6, name: '남색', r:   0, g:   0, b: 128 },
  { idx: 7, name: '보라', r: 128, g:   0, b: 128 },
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
