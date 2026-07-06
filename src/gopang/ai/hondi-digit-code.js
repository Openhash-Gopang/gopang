/**
 * hondi-digit-code.js — 혼디 숫자 코드 인코더 / 디코더
 *
 * 색상 코드(hondi-code.js)와 같은 계열의 시각 코드지만, 데이터를
 * 6색 팔레트 대신 실제 10진수 숫자(0~9)를 7세그먼트 스타일로 직접
 * 표시한다. 사람이 눈으로 읽어도 바로 숫자를 알 수 있다는 것이 색상
 * 코드 대비 장점(디버깅·수기 대조·전화 안내 등에 유리).
 *
 * 레이아웃: "혼디"에서 모음 "ㅣ" 획 자리를 실제 숫자열로 대체한다 —
 * 로고는 색상 코드와 동일 자산(혼+ㄷ)을 재사용하되 ㅣ 획만 잘라내고,
 * 그 자리에 10칸 숫자열을 이어 붙인다. "ㄷ"은 데이터 없이 순수
 * 기준점(앵커) 역할만 한다 — 정확히 한쪽 면만 뚫린 모양이라, 사진이
 * 어느 방향으로 돌아가 있어도(0/90/180/270도) 뚫린 방향만 찾으면
 * 전체 회전을 되돌릴 수 있다(hondi-digit-scanner.js 참고).
 *
 * 버전: 10칸 고정, 000000 0000 ~ 999999 9999 (10^10, 100억 가지)
 */

// ── 7세그먼트 패턴 (a~g), hondi-7seg-guide.html과 동일 정의 ──────
export const SEGMENT_PATTERNS = {
  0:'abcdef', 1:'bc', 2:'abged', 3:'abgcd', 4:'fgbc',
  5:'afgcd', 6:'afgecd', 7:'abc', 8:'abcdefg', 9:'abcdfg',
};
export const SEG_ORDER = ['a','b','c','d','e','f','g'];

export const DIGIT_COUNT = 10;
export const MAX_DIGIT_ID = 10n ** BigInt(DIGIT_COUNT); // 10^10 = 100억

// ── short_id(BigInt) ↔ 숫자 배열 ─────────────────────────────
export function idToDigits(id) {
  const n = BigInt(id);
  if (n < 0n || n >= MAX_DIGIT_ID) {
    throw new Error(`숫자 코드 범위 초과: 0 ~ ${(MAX_DIGIT_ID-1n)}까지만 가능합니다.`);
  }
  const s = n.toString().padStart(DIGIT_COUNT, '0');
  return s.split('').map(Number);
}

export function digitsToId(digits) {
  return BigInt(digits.join(''));
}

// ── 로고("혼"+"ㄷ") 베이스 이미지 — 색상 코드와 동일 자산에서
// 모음 "ㅣ" 획만 잘라낸 버전(그 자리를 실제 숫자열로 대체하므로).
export const LOGO_IMG_URL = 'data:image/png;base64,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';
export const LOGO_IMG_W = 420, LOGO_IMG_H = 335;

// ── 숫자열 그리드 치수 ────────────────────────────────────────
export const DIGIT_BOX_W = 70;
export const DIGIT_BOX_H = 108;
export const DIGIT_GAP_X = 16;    // 로고(ㄷ) 오른쪽과 숫자열 사이 간격
export const SEG_THICK_RATIO = 0.12; // 세그먼트 두께(칸 폭 대비)

let _logoPromise = null;
function _loadLogo() {
  if (_logoPromise) return _logoPromise;
  _logoPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('숫자 코드 로고 이미지 로드 실패: ' + LOGO_IMG_URL));
    img.src = LOGO_IMG_URL;
  });
  return _logoPromise;
}

// 세그먼트 좌표 비율 — hondi-7seg-guide.html의 SEG_BOXES와 동일 기준
const SEG_BOXES = {
  a: { x1:0.20, x2:0.80, y1:0.00, y2:0.10 },
  g: { x1:0.20, x2:0.80, y1:0.45, y2:0.55 },
  d: { x1:0.20, x2:0.80, y1:0.90, y2:1.00 },
  f: { x1:0.00, x2:0.22, y1:0.08, y2:0.44 },
  b: { x1:0.78, x2:1.00, y1:0.08, y2:0.44 },
  e: { x1:0.00, x2:0.22, y1:0.56, y2:0.92 },
  c: { x1:0.78, x2:1.00, y1:0.56, y2:0.92 },
};

function _drawDigitBox(ctx, x, y, w, h, digit) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, Math.round(w*0.03));
  ctx.strokeRect(x, y, w, h);

  const segs = SEGMENT_PATTERNS[digit];
  ctx.fillStyle = '#000000';
  for (const s of SEG_ORDER) {
    if (!segs.includes(s)) continue;
    const box = SEG_BOXES[s];
    ctx.fillRect(
      x + box.x1*w, y + box.y1*h,
      (box.x2-box.x1)*w, (box.y2-box.y1)*h,
    );
  }
}

export async function generateDigitCodeCanvas(shortId) {
  const logo = await _loadLogo();
  const digits = idToDigits(shortId);

  const stripH = DIGIT_BOX_H * DIGIT_COUNT;
  const PAD = 16;
  const CANVAS_W = PAD + LOGO_IMG_W + DIGIT_GAP_X + DIGIT_BOX_W + PAD;
  const CANVAS_H = PAD + Math.max(LOGO_IMG_H, stripH) + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const logoY = PAD + Math.round((Math.max(LOGO_IMG_H, stripH) - LOGO_IMG_H) / 2);
  ctx.drawImage(logo, PAD, logoY, LOGO_IMG_W, LOGO_IMG_H);

  const stripX = PAD + LOGO_IMG_W + DIGIT_GAP_X;
  const stripY = PAD + Math.round((Math.max(LOGO_IMG_H, stripH) - stripH) / 2);
  digits.forEach((d, i) => {
    _drawDigitBox(ctx, stripX, stripY + i*DIGIT_BOX_H, DIGIT_BOX_W, DIGIT_BOX_H, d);
  });

  return canvas;
}

export async function generateDigitCodeDataURL(shortId) {
  const canvas = await generateDigitCodeCanvas(shortId);
  return canvas.toDataURL('image/png');
}
