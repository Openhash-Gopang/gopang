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
  { idx: 2, name: '주황', r: 255, g: 110, b:   0 },
  { idx: 3, name: '노랑', r: 255, g: 235, b:   0 },
  { idx: 4, name: '초록', r:   0, g: 185, b:   0 },
  { idx: 5, name: '파랑', r:   0, g:   0, b: 220 },
  { idx: 6, name: '남색', r:   0, g:   0, b: 180 },  // (0,0,100)→(0,0,180): 흑색과 거리 확보
  { idx: 7, name: '보라', r: 180, g:   0, b: 180 },  // (150,0,150)→(180,0,180): 더 선명
  { idx: 8, name: '흑색', r:  30, g:  30, b:  30 },  // (0,0,0)→(30,30,30): 흰 경계선과 구분
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
  //
  // G채널 보정 기준: 배경(bg) 흰색의 G채널을 사용한다.
  // 단, bg 샘플이 (0,0,0) 또는 어두운 영역을 가리킬 경우
  // (ROI가 화면 밖이거나 검정 배경) gScale이 255로 치솟아
  // 모든 픽셀의 G채널을 포화시키는 치명적 오류가 발생한다.
  //
  // Fallback 전략: bg.g < 30이면 bg를 신뢰하지 않고
  // 대신 "hih(파랑)의 R/G/B 비율"을 활용해 gScale을 추정한다.
  //   파랑(0,0,220) 기준: 측정된 hih의 R·G 채널은 거의 0이어야 하므로,
  //   hih.g ≈ 0 → G 보정 없이 1.0 사용 (보수적 기본값).
  //   이 경우 gScale=1.0 → G채널 보정 생략 (색상 인식은 R·B로 충분).
  const bg_g = measured.bg.g > 30 ? measured.bg.g : 255;
  return {
    rScale: CALIB_REF.ho.r  / Math.max(1, measured.ho.r),
    gScale: CALIB_REF.bg.g  / Math.max(1, bg_g),
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
// 방식: "혼ㄷ" 부분은 공용 베이스 이미지(/icons/hondi-base-hond.png, 680×542,
// 투명배경)를 그대로 불러와 고정 위치에 그리고, 색상 코드("ㅣ")만 정확한
// 픽셀 좌표에 사각형으로 덧그린다. 매번 도형을 새로 그리지 않으므로 결과가
// 항상 동일하고 빠르다. 브라우저 환경(document/Image 필요)에서만 동작.
//
// ── 픽셀 좌표 사양 (베이스 이미지 680×542 기준) ───────────────
//   ㄷ의 오른쪽 끝(로컬 x)             : 665
//   색상 코드 시작 x (STRIP_X)         : 705   (ㄷ 끝 + 40px 간격)
//   색상 코드 시작 y (STRIP_Y)         : 15    (ㅎㅗㄴㄷ 컨텐츠 상단과 동일)
//   색상 코드 전체 폭 (STRIP_W)        : 65    (v1: 1열 65px / v2: 2열 32.5px씩)
//   색상 코드 전체 높이 (STRIP_H)      : 512   (10칸 → 칸당 51.2px)
//   캔버스 전체 크기                   : 785 × 542 (오른쪽 여백 15px 포함)
export const BASE_IMG_URL = '/icons/hondi-base-hond.png';
export const BASE_IMG_W = 680, BASE_IMG_H = 542;
export const STRIP_X = 705, STRIP_Y = 15, STRIP_W = 65, STRIP_H = 512;
// ── 캘리브레이션 패치 (색상 막대 아래, 9색을 가로로 배열) ──
export const PATCH_Y      = STRIP_Y + STRIP_H + 15;  // 542
export const PATCH_H      = 65;                        // 정사각형 (STRIP_W와 동일)
export const PATCH_START_X= 120;                       // 705 - 65×9
export const CANVAS_W = 785, CANVAS_H = PATCH_Y + PATCH_H + 10;  // 622
const ROWS = 10;
const CELL_H = STRIP_H / ROWS;   // 51.2

let _baseImgPromise = null;
function _loadBaseImage() {
  if (_baseImgPromise) return _baseImgPromise;
  _baseImgPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('혼ㄷ 베이스 이미지 로드 실패: ' + BASE_IMG_URL));
    img.src = BASE_IMG_URL;
  });
  return _baseImgPromise;
}

export async function generateHondiCodeCanvas(shortId, version = 'v1', { markers = false } = {}) {
  const baseImg = await _loadBaseImage();

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  // 배경 흰색 + "혼ㄷ" 베이스 이미지를 (0,0)에 고정 배치
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.drawImage(baseImg, 0, 0, BASE_IMG_W, BASE_IMG_H);

  // 색상 코드("ㅣ") — 정확한 픽셀 좌표(STRIP_X, STRIP_Y, STRIP_W, STRIP_H)에 덧그림
  // 칸 순서는 idToIndices와 동일: 배열 첫 원소(최상위 자릿수)가 맨 위 칸.
  const indices = idToIndices(BigInt(shortId), version);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';  // 흰색 경계선 — 흑색 셀과 충돌 방지
  ctx.lineWidth = 1.5;

  if (version === 'v1') {
    for (let row = 0; row < ROWS; row++) {
      const c = PALETTE[indices[row]];
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.fillRect(STRIP_X, STRIP_Y + row * CELL_H, STRIP_W, CELL_H);
      ctx.strokeRect(STRIP_X, STRIP_Y + row * CELL_H, STRIP_W, CELL_H);
    }
  } else {
    const halfW = STRIP_W / 2;
    for (let row = 0; row < ROWS; row++) {
      const y = STRIP_Y + row * CELL_H;
      const cL = PALETTE[indices[row * 2]];
      const cR = PALETTE[indices[row * 2 + 1]];
      ctx.fillStyle = `rgb(${cL.r},${cL.g},${cL.b})`;
      ctx.fillRect(STRIP_X, y, halfW, CELL_H);
      ctx.fillStyle = `rgb(${cR.r},${cR.g},${cR.b})`;
      ctx.fillRect(STRIP_X + halfW, y, halfW, CELL_H);
      ctx.strokeRect(STRIP_X, y, STRIP_W, CELL_H);
    }
  }

  // ── 기준점 마커: 모니터 표시용 (markers=true 시에만) ──
  // 막대 상단/하단에 흰 원 2개를 배치 → 스캐너가 막대 Y 범위를 정확히 확정
  if (markers) {
    const MR  = Math.round(STRIP_W * 0.22);  // 반지름 (막대 너비의 22%)
    const MX  = STRIP_X - MR * 2 - 8;        // 막대 왼쪽에 배치
    const MY_A = STRIP_Y;                      // 상단 기준점 Y
    const MY_B = STRIP_Y + STRIP_H;            // 하단 기준점 Y

    [MY_A, MY_B].forEach(my => {
      // 검은 테두리
      ctx.beginPath();
      ctx.arc(MX, my, MR + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      // 흰 원
      ctx.beginPath();
      ctx.arc(MX, my, MR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    // 두 기준점 사이 연결선 (점선)
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.moveTo(MX, MY_A + MR);
    ctx.lineTo(MX, MY_B - MR);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── 캘리브레이션 패치: 9색을 PATCH_Y에 가로로 배열 ──
  // 스캐너가 이 패치를 읽어 실제 카메라 환경의 색상값을 측정한다.
  const patchBorder = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = patchBorder;
  PALETTE.forEach((c, i) => {
    const px = PATCH_START_X + i * STRIP_W;
    ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
    ctx.fillRect(px, PATCH_Y, STRIP_W, PATCH_H);
    ctx.strokeRect(px, PATCH_Y, STRIP_W, PATCH_H);
  });
  // 패치 영역 라벨 (작은 텍스트)
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(PATCH_START_X, PATCH_Y + PATCH_H + 2, STRIP_W * 9, 8);
  ctx.fillStyle = '#fff';
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CALIB', PATCH_START_X + (STRIP_W * 9) / 2, PATCH_Y + PATCH_H + 8);

  return canvas;
}

// 가입·설정 화면에서 바로 쓰는 편의 함수 — data URL(PNG) 반환 (비동기!)
export async function generateHondiCodeDataURL(shortId, version = 'v1') {
  const canvas = await generateHondiCodeCanvas(shortId, version);
  return canvas.toDataURL('image/png');
}
