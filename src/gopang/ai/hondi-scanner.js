/**
 * hondi-scanner.js — 혼디 시각 코드 스캐너
 *
 * 동작 순서:
 *   1. 카메라 스트림 오픈 (후면 카메라 우선)
 *   2. 매 프레임 canvas에 렌더
 *   3. "혼디" 글자 윤곽 감지 (색상 기반 ROI 탐지)
 *   4. 자모별 ROI 추출 → 캘리브레이션 행렬 산출
 *   5. "ㄷ" 분석 → v1/v2 버전 판별
 *   6. "ㅣ" 영역 분할 → 각 칸 색상 추출 → 인덱스 배열
 *   7. short_id 복원 → L1 조회 → 프로필 이동
 */

import {
  PALETTE, CALIB_REF,
  detectVersion, buildCalibMatrix, applyCalib,
  rgbToIndex, indicesToId,
} from './hondi-code.js';

// ── 상수 ──────────────────────────────────────────────────────
const SCAN_INTERVAL_MS  = 200;   // 스캔 주기 (5fps)
const MIN_HONDI_HEIGHT  = 60;    // 인식 최소 높이(px)
const LOCK_FRAMES       = 5;     // 연속 N프레임 일치 시 확정

// ── 스캐너 상태 ───────────────────────────────────────────────
let _stream     = null;
let _timer      = null;
let _lockCount  = 0;
let _lastId     = null;
let _onResult   = null;   // 성공 콜백: (shortId, version) => void
let _onStatus   = null;   // 상태 메시지 콜백: (msg) => void

// ── 공개 API ──────────────────────────────────────────────────

/**
 * 스캐너 시작
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} canvas
 * @param {Function} onResult  (shortId:BigInt, version:'v1'|'v2') => void
 * @param {Function} onStatus  (message:string) => void
 */
export async function startScanner(video, canvas, onResult, onStatus) {
  _onResult = onResult;
  _onStatus = onStatus;

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },  // 후면 카메라 우선
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = _stream;
    await video.play();

    _status('카메라 준비 완료. "혼디" 글자를 화면에 맞춰주세요.');
    _timer = setInterval(() => _scanFrame(video, canvas), SCAN_INTERVAL_MS);

  } catch (e) {
    _status(`카메라 오류: ${e.message}`);
    throw e;
  }
}

/** 스캐너 정지 */
export function stopScanner() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  _lockCount = 0;
  _lastId    = null;
}

// ── 프레임 스캔 ───────────────────────────────────────────────
function _scanFrame(video, canvas) {
  if (video.readyState < 2) return;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  // 1. "혼디" 글자 ROI 탐지
  const roi = _detectHondiROI(ctx, canvas.width, canvas.height);
  if (!roi) {
    _lockCount = 0;
    _status('혼디 글자를 찾는 중...');
    return;
  }

  // 2. 캘리브레이션 기준점 샘플링
  const calib = _sampleCalibPoints(ctx, roi);

  // 3. 버전 판별 (ㄷ 분석)
  const dSamples = _sampleRegion(ctx, roi.d);
  const version  = detectVersion(dSamples);

  // 4. ㅣ 영역 분할 → 색상 인덱스 배열
  const matrix  = buildCalibMatrix(calib);
  const indices = _extractIndices(ctx, roi.i, version, matrix);

  // 5. short_id 복원
  const shortId = indicesToId(indices);

  // 6. 연속 일치 확인 (노이즈 방지)
  if (_lastId === shortId.toString()) {
    _lockCount++;
  } else {
    _lockCount = 1;
    _lastId    = shortId.toString();
  }

  _status(`인식 중... (${_lockCount}/${LOCK_FRAMES}) [${version}] ID: ${shortId}`);

  if (_lockCount >= LOCK_FRAMES) {
    stopScanner();
    _onResult?.(shortId, version);
  }
}

// ── "혼디" 글자 ROI 탐지 ─────────────────────────────────────
// 전략: ㅎ(파랑)과 ㅗ(빨강) 색상 픽셀을 찾아 글자 영역 추정
function _detectHondiROI(ctx, W, H) {
  // 썸네일로 빠른 스캔
  const THUMB = 4;
  const data  = ctx.getImageData(0, 0, W, H).data;

  let bluePixels = [], redPixels = [];

  for (let y = 0; y < H; y += THUMB) {
    for (let x = 0; x < W; x += THUMB) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];

      // ㅎ 파랑: b 우세, r·g 낮음
      if (b > 150 && r < 80 && g < 80) bluePixels.push({ x, y });
      // ㅗ 빨강: r 우세, g·b 낮음
      if (r > 150 && g < 80 && b < 80) redPixels.push({ x, y });
    }
  }

  if (bluePixels.length < 10 || redPixels.length < 10) return null;

  // 바운딩 박스 산출
  const allX = [...bluePixels, ...redPixels].map(p => p.x);
  const allY = [...bluePixels, ...redPixels].map(p => p.y);
  const x1 = Math.min(...allX), x2 = Math.max(...allX);
  const y1 = Math.min(...allY), y2 = Math.max(...allY);
  const gW  = x2 - x1, gH = y2 - y1;

  if (gH < MIN_HONDI_HEIGHT) return null;

  // "혼디" 글자 레이아웃 추정
  // ㅎ·혼 = 좌측 절반, ㄷ·ㅣ = 우측 절반
  // 세로 비율로 각 자모 ROI 산출
  const midX  = x1 + gW * 0.5;
  const unitH = gH / 3;   // ㅎ/ㅗ/ㄴ 세 구역

  return {
    // 전체 글자 영역
    full: { x: x1, y: y1, w: gW, h: gH },

    // 캘리브레이션 기준점 ROI
    hih: { x: x1,        y: y1,            w: gW*0.4, h: unitH*0.6 },  // ㅎ (파랑)
    ho:  { x: x1+gW*0.1, y: y1+unitH*0.5,  w: gW*0.3, h: unitH*0.4 },  // ㅗ (빨강)
    n:   { x: x1,        y: y1+unitH*1.7,  w: gW*0.4, h: unitH*0.3 },  // ㄴ (검정)
    bg:  { x: x2+10,     y: y1,            w: 20,     h: 20         },  // 배경 (흰색)

    // 버전 판별용
    d:   { x: midX,      y: y1+unitH*0.2,  w: gW*0.4, h: gH*0.6    },  // ㄷ

    // 데이터 영역: ㅣ
    i:   { x: midX+gW*0.3, y: y1,          w: gW*0.15, h: gH        },  // ㅣ
  };
}

// ── 캘리브레이션 기준점 샘플링 ───────────────────────────────
function _sampleCalibPoints(ctx, roi) {
  return {
    hih: _avgColor(ctx, roi.hih),
    ho:  _avgColor(ctx, roi.ho),
    n:   _avgColor(ctx, roi.n),
    bg:  _avgColor(ctx, roi.bg),
  };
}

// ── ㅣ 영역 → 색상 인덱스 배열 추출 ─────────────────────────
function _extractIndices(ctx, iRoi, version, matrix) {
  const ROWS = 10;
  const cellH = iRoi.h / ROWS;
  const indices = [];

  if (version === 'v1') {
    // 단열: ㅣ 전체 너비를 1칸으로 사용
    for (let row = 0; row < ROWS; row++) {
      const cell = {
        x: iRoi.x,
        y: iRoi.y + row * cellH,
        w: iRoi.w,
        h: cellH,
      };
      const raw = _avgColor(ctx, cell);
      const cal = applyCalib(raw, matrix);
      indices.push(rgbToIndex(cal));
    }
  } else {
    // 복열: ㅣ를 좌열/우열로 2분할
    const halfW = iRoi.w / 2;
    for (let row = 0; row < ROWS; row++) {
      const y = iRoi.y + row * cellH;
      // 좌열
      const leftRaw = _avgColor(ctx, { x: iRoi.x,         y, w: halfW, h: cellH });
      const leftCal = applyCalib(leftRaw, matrix);
      indices.push(rgbToIndex(leftCal));
      // 우열
      const rightRaw = _avgColor(ctx, { x: iRoi.x + halfW, y, w: halfW, h: cellH });
      const rightCal = applyCalib(rightRaw, matrix);
      indices.push(rgbToIndex(rightCal));
    }
  }

  return indices;
}

// ── 픽셀 평균 색상 ────────────────────────────────────────────
function _avgColor(ctx, { x, y, w, h }) {
  const ix = Math.round(x), iy = Math.round(y);
  const iw = Math.max(1, Math.round(w)), ih = Math.max(1, Math.round(h));
  const data = ctx.getImageData(ix, iy, iw, ih).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i+1]; b += data[i+2];
    count++;
  }
  return count === 0 ? { r: 0, g: 0, b: 0 }
       : { r: r/count, g: g/count, b: b/count };
}

// ── 영역 샘플 픽셀 배열 ──────────────────────────────────────
function _sampleRegion(ctx, { x, y, w, h }, step = 4) {
  const ix = Math.round(x), iy = Math.round(y);
  const iw = Math.max(1, Math.round(w)), ih = Math.max(1, Math.round(h));
  const data = ctx.getImageData(ix, iy, iw, ih).data;
  const samples = [];
  for (let i = 0; i < data.length; i += 4 * step) {
    samples.push({ r: data[i], g: data[i+1], b: data[i+2] });
  }
  return samples;
}

// ── 상태 메시지 ───────────────────────────────────────────────
function _status(msg) {
  _onStatus?.(msg);
}

// ── L1 조회 → 프로필 URL ─────────────────────────────────────
export async function lookupProfile(shortId, version) {
  try {
    // L1_URL은 gopang-app.js에서 window.L1_URL로 노출
    const base = (typeof L1_URL !== 'undefined' ? L1_URL : '')
      .replace('/api/collections/profiles/records', '');

    const res = await fetch(
      `${base}/api/collections/profiles/records` +
      `?filter=(short_id='${shortId.toString()}')&perPage=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`L1 응답 오류: ${res.status}`);

    const data = await res.json();
    if (!data.items?.length) throw new Error('등록되지 않은 혼디 코드입니다.');

    const profile = data.items[0];
    return {
      guid:    profile.ipv6 || profile.id,
      handle:  profile.handle,
      name:    profile.name,
      url:     `https://gopang.net/profile?id=${profile.id}`,
    };
  } catch (e) {
    throw new Error(`프로필 조회 실패: ${e.message}`);
  }
}
