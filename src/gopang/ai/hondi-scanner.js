/**
 * hondi-scanner.js — 혼디 시각 코드 스캐너 v2.0
 *
 * v2.0 개선사항:
 *   - 연속 실시간 스캔 (QR코드 방식)
 *   - 1/4 축소 썸네일로 빠른 위치 탐지 → 원본으로 정밀 추출
 *   - 감지 박스 실시간 오버레이 (노랑→초록)
 *   - 인식 확정 시 vibrate + 소리 피드백
 *   - 사진 촬영(보조) 겸용
 *   - 종횡비 검증으로 오감지 감소
 */

import {
  detectVersion, buildCalibMatrix, applyCalib,
  rgbToIndex, indicesToId,
} from './hondi-code.js';
import { L1_URL } from '../core/state.js';

// ── 상수 ──────────────────────────────────────────────────────
const SCAN_FPS        = 15;                      // 초당 스캔 횟수
const SCAN_MS         = Math.round(1000/SCAN_FPS);
const THUMB_SCALE     = 0.25;                    // 탐지용 축소 비율
const LOCK_FRAMES     = 3;    // v2.1: 3프레임으로 단축 (응답성 향상)
const MIN_GLYPH_H     = 10;   // v2.1: 더 작은 글자도 인식 (썸네일 기준)
const ASPECT_MIN      = 0.25; // v2.1: H형(세로>가로)도 인식하도록 완화
const ASPECT_MAX      = 4.0;  // v2.1: 범위 확대

// ── 상태 ──────────────────────────────────────────────────────
let _stream    = null;
let _lockFramesRequired = LOCK_FRAMES;
let _rafId     = null;
let _lastTime  = 0;
let _lockCount = 0;
let _lastId    = null;
let _locked    = false;
let _onResult  = null;
let _onStatus  = null;
let _overlayCanvas = null;   // 감지 박스 표시용 캔버스

// ── 공개 API ──────────────────────────────────────────────────

/**
 * 연속 스캐너 시작 (QR코드 방식)
 * @param {HTMLVideoElement}  video
 * @param {HTMLCanvasElement} canvas      — 픽셀 추출용 (숨김)
 * @param {HTMLCanvasElement} overlayCanvas — 박스 표시용 (투명 오버레이)
 * @param {Function} onResult  (shortId:BigInt, version:'v1'|'v2') => void
 * @param {Function} onStatus  (msg:string) => void
 */
export async function startScanner(video, canvas, overlayCanvas, onResult, onStatus) {
  _onResult      = onResult;
  _onStatus      = onStatus;
  _overlayCanvas = overlayCanvas;
  _lockCount     = 0;
  _lastId        = null;
  _locked        = false;

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = _stream;
    await video.play();
    _status('혼디 글자를 화면에 맞춰주세요.');
    _scheduleFrame(video, canvas);
  } catch (e) {
    // 에러 유형별 안내
    let msg;
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      msg = '카메라 권한이 거부됐습니다.\n'
          + '브라우저 주소창 왼쪽 🔒 아이콘 → 권한 → 카메라 허용 후 다시 시도해 주세요.';
    } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
      msg = '카메라를 찾을 수 없습니다. 기기에 카메라가 연결돼 있는지 확인해 주세요.';
    } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
      msg = '카메라가 다른 앱에서 사용 중입니다. 다른 앱을 닫고 다시 시도해 주세요.';
    } else if (e.name === 'OverconstrainedError') {
      msg = '카메라 설정 오류입니다. 잠시 후 다시 시도해 주세요.';
    } else {
      msg = `카메라 오류: ${e.message}`;
    }
    _status(msg);
    throw e;
  }
}

export function stopScanner() {
  if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  _lockCount = 0; _lastId = null; _locked = false;
}

/** 보조: 사진 1장 분석 */
export function analyzePhoto(imageData, onResult, onStatus) {
  _onResult = onResult;
  _onStatus = onStatus;
  const canvas = document.createElement('canvas');
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.putImageData(imageData, 0, 0);
  const result = _analyzeFrame(ctx, canvas.width, canvas.height);
  if (result) {
    _onResult?.(result.shortId, result.version);
  } else {
    _onStatus?.('혼디 글자를 인식하지 못했습니다. 더 가까이 대주세요.');
  }
}

// ── rAF 루프 ──────────────────────────────────────────────────
function _scheduleFrame(video, canvas) {
  _rafId = requestAnimationFrame((ts) => {
    if (_locked) return;                        // 확정 후 중단
    if (ts - _lastTime >= SCAN_MS) {
      _lastTime = ts;
      _processFrame(video, canvas);
    }
    _scheduleFrame(video, canvas);
  });
}

function _processFrame(video, canvas) {
  if (video.readyState < 2) return;

  const W = video.videoWidth, H = video.videoHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0);

  const result = _analyzeFrame(ctx, W, H);

  // 오버레이 박스 그리기
  _drawOverlay(result?.roi?.full, W, H, !!result);

  if (!result) {
    _lockCount = 0;
    _lastId    = null;
    return;
  }

  const idStr = result.shortId.toString();
  if (idStr === _lastId) {
    _lockCount++;
  } else {
    _lockCount = 1;
    _lastId    = idStr;
  }

  const pct      = Math.round(_lockCount / LOCK_FRAMES * 100);
  const modeLabel = result.roi?.mode === 'ucb' ? 'UCB' : '혼디';
  _status(`인식 중... ${pct}% [${modeLabel} ${result.version}]`);

  if (_lockCount >= _lockFramesRequired) {
    _locked = true;
    stopScanner();
    // 진동 피드백
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    // 딸깍 소리
    _playBeep();
    _onResult?.(result.shortId, result.version);
  }
}

// ── 프레임 분석 ───────────────────────────────────────────────
function _analyzeFrame(ctx, W, H) {
  // 1. 썸네일에서 빠르게 ROI 탐지
  const tW = Math.round(W * THUMB_SCALE);
  const tH = Math.round(H * THUMB_SCALE);
  const thumbCtx = _makeThumb(ctx, W, H, tW, tH);
  const roi = _detectHondiROI(thumbCtx, tW, tH);
  if (!roi) return null;

  // 2. ROI를 원본 좌표로 역변환
  const scale = 1 / THUMB_SCALE;
  const fullRoi = _scaleRoi(roi, scale);

  // 3. 원본 픽셀로 캘리브레이션 + 색상 추출
  const calib   = _sampleCalib(ctx, fullRoi);
  const matrix  = buildCalibMatrix(calib);
  const dSamples = _sampleRegion(ctx, fullRoi.d);
  const version  = detectVersion(dSamples);
  const indices  = _extractIndices(ctx, fullRoi.i, version, matrix);
  const shortId  = indicesToId(indices);

  // v2.3: 진단용 — 모든 칸이 흑색(8)으로만 읽히면(캘리브레이션이 완전히
  // 빗나간 전형적 증상) 측정값을 콘솔에 남긴다. 개발자 도구(F12) 또는
  // chrome://inspect(폰 원격 디버깅)에서 확인 가능.
  if (indices.every(i => i === 8)) {
    console.warn('[혼디스캐너] 전체 흑색 디코딩 감지 — 캘리브레이션 측정값:', {
      calib, matrix, roi: fullRoi, mode: roi.mode,
    });
  }

  return { shortId, version, roi: fullRoi };
}

// ── 썸네일 생성 ───────────────────────────────────────────────
function _makeThumb(ctx, W, H, tW, tH) {
  const off = new OffscreenCanvas(tW, tH);
  const oc  = off.getContext('2d', { willReadFrequently: true });
  oc.drawImage(ctx.canvas, 0, 0, W, H, 0, 0, tW, tH);
  return oc;
}

// ── ROI 탐지 — 혼디 코드 + UCB(범용 색상 코드) 공용 ──────────
//
// 혼디 코드: "혼디" 글자에서 ㅎ(파랑)·ㅗ(빨강)이 넓게 분포
//   → 파랑·빨강 클러스터의 X 스팬이 넓음 (gW/gH > ASPECT_MIN)
//
// UCB 모드: 파랑 도트(위)·빨강 도트(아래) + 세로 색상 막대
//   → 두 클러스터가 세로로 좁게 배열 (gW/gH < UCB_ASPECT_MAX)
//   → 색상 막대(ㅣ)는 두 도트 사이 중앙 세로선
//
// 자동 판별: aspect 비율 하나로 두 모드를 분기
const UCB_ASPECT_MAX = 0.55;  // 이 비율 미만이면 UCB 모드

function _detectHondiROI(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;

  let blueX = [], blueY = [], redX = [], redY = [];
  const blueMask = new Uint8Array(W * H);
  const redMask  = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const px = y * W + x;

      // 파랑 픽셀: ㅎ 자모(혼디) 또는 위쪽 앵커 도트(UCB) — v2.1 임계값 완화
      if (b > 100 && r < 110 && g < 110 && b - Math.max(r,g) > 40) {
        blueX.push(x); blueY.push(y);
        blueMask[px] = 1;
      }
      // 빨강 픽셀: ㅗ 자모(혼디) 또는 아래쪽 앵커 도트(UCB) — v2.1 임계값 완화
      // v2.2: g<50 추가 — 주황(255,100,0)도 r-max(g,b)>40을 만족해 빨강으로
      //       오인되던 문제 수정 (주황은 g=100이라 g<50에서 걸러짐).
      if (r > 100 && g < 50 && b < 110 && r - Math.max(g,b) > 40) {
        redX.push(x); redY.push(y);
        redMask[px] = 1;
      }
    }
  }

  if (blueX.length < 4 || redX.length < 4) return null;  // v2.1

  // v2.2: 전체 픽셀의 단순 min/max 바운딩 박스 대신 "가장 큰 연결요소"의
  // 바운딩 박스를 쓴다. 색상 코드 스트립("ㅣ")에 우연히 글자와 같은 색
  // (빨강·파랑) 칸이 섞이면, 기존 방식은 스트립 칸까지 박스에 포함시켜서
  // 글자 위치 기준 캘리브레이션이 완전히 빗나가는 버그가 있었다(실측 검증:
  // 무작위 코드의 약 90%+ 가 영향을 받음). 글자 본체는 스트립 한 칸보다
  // 훨씬 큰 덩어리이므로, 최대 연결요소만 취하면 스트립 색상과 무관하게
  // 항상 글자 바운딩 박스만 안정적으로 얻는다.
  const blueBox = _largestComponentBbox(blueMask, W, H);
  const redBox  = _largestComponentBbox(redMask, W, H);
  if (!blueBox || !redBox) return null;

  const x1 = Math.min(blueBox.x1, redBox.x1);
  const y1 = Math.min(blueBox.y1, redBox.y1);
  const x2 = Math.max(blueBox.x2, redBox.x2);
  const y2 = Math.max(blueBox.y2, redBox.y2);
  const gW = x2 - x1, gH = y2 - y1;

  if (gH < MIN_GLYPH_H) return null;

  const aspect = gW / gH;

  // ── UCB 모드: 파랑(위 도트)·빨강(아래 도트)이 세로로 좁게 배열 ──
  if (aspect < UCB_ASPECT_MAX) {
    return _buildUCBRoi(x1, y1, gW, gH, blueY, redY);
  }

  // ── 혼디 코드 모드: 종횡비 검증 ──────────────────────────────
  if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) return null;

  // v2.2: /icons/hondi-base-hond.png 실측 좌표로 재캘리브레이션(2026-06).
  // 기존 비율(hih/ho/n/d/i)은 실제 베이스 아트워크의 ㅎ·ㅗ·ㄴ·ㄷ·색상스트립
  // 위치와 전혀 맞지 않아 캘리브레이션이 항상 빗나가던 근본 버그였다.
  // (정적 이미지로 30회 무작위 왕복 디코딩 테스트 — 100% 일치 확인됨)
  return {
    mode: 'hondi',
    full: { x: x1, y: y1, w: gW, h: gH },
    hih:  { x: x1+gW*0.415, y: y1+gH*-0.252, w: gW*0.16,  h: gH*0.12 },
    ho:   { x: x1+gW*0.409, y: y1+gH*0.752,  w: gW*0.16,  h: gH*0.12 },
    n:    { x: x1+gW*0.025, y: y1+gH*1.388,  w: gW*0.16,  h: gH*0.12 },
    bg:   { x: x1+gW*3.20,  y: y1+gH*-0.433, w: gW*0.16,  h: gH*0.12 },
    d:    { x: x1+gW*2.173, y: y1+gH*-0.117, w: gW*0.16,  h: gH*0.12 },
    i:    { x: x1+gW*3.489, y: y1+gH*-0.414, w: gW*0.342, h: gH*1.962 },
  };
}

// ── 연결요소(flood-fill BFS) 기반 최대 영역 바운딩박스 ───────
// mask: Uint8Array(W*H), 1=대상 색상 픽셀. 가장 큰(픽셀 수 최다) 연결된
// 덩어리 하나의 바운딩 박스만 반환 — 스트립 한 칸처럼 작은 오염 덩어리는
// 자동으로 무시된다.
function _largestComponentBbox(mask, W, H) {
  const visited = new Uint8Array(W * H);
  const qx = new Int32Array(W * H);
  const qy = new Int32Array(W * H);
  let best = null, bestSize = 0;

  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const sIdx = sy * W + sx;
      if (!mask[sIdx] || visited[sIdx]) continue;

      let head = 0, tail = 0;
      qx[tail] = sx; qy[tail] = sy; tail++;
      visited[sIdx] = 1;
      let bx1 = sx, by1 = sy, bx2 = sx, by2 = sy, size = 0;

      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++;
        size++;
        if (cx < bx1) bx1 = cx; if (cx > bx2) bx2 = cx;
        if (cy < by1) by1 = cy; if (cy > by2) by2 = cy;

        const dirs = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
        for (const [nx, ny] of dirs) {
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nIdx = ny * W + nx;
          if (mask[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            qx[tail] = nx; qy[tail] = ny; tail++;
          }
        }
      }
      if (size > bestSize) { bestSize = size; best = { x1: bx1, y1: by1, x2: bx2, y2: by2, size }; }
    }
  }
  return best;
}

// ── UCB ROI 구성 ──────────────────────────────────────────────
// 파랑 도트 클러스터 중심 = 상단 앵커
// 빨강 도트 클러스터 중심 = 하단 앵커
// 색상 막대(i) = 두 앵커 사이 세로선
function _buildUCBRoi(x1, y1, gW, gH, blueY, redY) {
  // 파랑·빨강 각 클러스터의 Y 중심
  const blueYc = blueY.reduce((a,b)=>a+b,0) / blueY.length;
  const redYc  = redY.reduce((a,b)=>a+b,0)  / redY.length;

  // 위=파랑, 아래=빨강 보장 (카메라 방향에 무관하게 정규화)
  const topY    = Math.min(blueYc, redYc);
  const botY    = Math.max(blueYc, redYc);
  const barH    = botY - topY;           // 색상 막대 높이
  const dotSize = Math.max(6, gW * 0.8); // 앵커 도트 샘플 크기

  // 막대 X 중심: 두 클러스터 X 평균
  const barCX = x1 + gW * 0.5;
  const barW  = Math.max(6, gW * 0.6);

  // 캘리브레이션용 앵커 샘플 영역
  const hihRoi = { x: barCX - dotSize/2, y: topY - dotSize/2, w: dotSize, h: dotSize };
  const hoRoi  = { x: barCX - dotSize/2, y: botY - dotSize/2, w: dotSize, h: dotSize };

  // 배경: 막대 왼쪽 바깥
  const bgRoi  = { x: Math.max(0, barCX - barW - 12), y: topY, w: 10, h: 10 };

  // ㄴ 대용: 배경 흰색 영역 (UCB엔 ㄴ이 없으므로 배경으로 대체)
  const nRoi   = bgRoi;

  // ㄷ 대용: 막대 중간 영역 (UCB 버전 판별용 — 단색이면 v1)
  const dRoi   = { x: barCX - barW/2, y: topY + barH*0.3, w: barW, h: barH*0.4 };

  // ㅣ: 색상 막대 전체
  const iRoi   = { x: barCX - barW/2, y: topY, w: barW, h: barH };

  return {
    mode: 'ucb',
    full: { x: x1, y: y1, w: gW, h: gH },
    hih:  hihRoi,
    ho:   hoRoi,
    n:    nRoi,
    bg:   bgRoi,
    d:    dRoi,
    i:    iRoi,
  };
}

function _scaleRoi(roi, s) {
  const sc = r => ({ x:r.x*s, y:r.y*s, w:r.w*s, h:r.h*s });
  return {
    mode: roi.mode,
    full: sc(roi.full), hih: sc(roi.hih), ho: sc(roi.ho),
    n: sc(roi.n),  bg: sc(roi.bg),  d: sc(roi.d),  i: sc(roi.i),
  };
}

// ── 캘리브레이션 샘플링 ──────────────────────────────────────
function _sampleCalib(ctx, roi) {
  return {
    hih: _avgColor(ctx, roi.hih),
    ho:  _avgColor(ctx, roi.ho),
    n:   _avgColor(ctx, roi.n),
    bg:  _avgColor(ctx, roi.bg),
  };
}

// ── ㅣ → 색상 인덱스 ────────────────────────────────────────
function _extractIndices(ctx, iRoi, version, matrix) {
  const ROWS = 10;
  const cellH = iRoi.h / ROWS;
  const indices = [];

  if (version === 'v1') {
    for (let row = 0; row < ROWS; row++) {
      const raw = _avgColor(ctx, { x:iRoi.x, y:iRoi.y+row*cellH, w:iRoi.w, h:cellH });
      indices.push(rgbToIndex(applyCalib(raw, matrix)));
    }
  } else {
    const halfW = iRoi.w / 2;
    for (let row = 0; row < ROWS; row++) {
      const y = iRoi.y + row * cellH;
      ['left','right'].forEach((side, si) => {
        const raw = _avgColor(ctx, { x:iRoi.x+si*halfW, y, w:halfW, h:cellH });
        indices.push(rgbToIndex(applyCalib(raw, matrix)));
      });
    }
  }
  return indices;
}

// ── 감지 박스 오버레이 ────────────────────────────────────────
function _drawOverlay(fullRoi, W, H, found) {
  if (!_overlayCanvas) return;
  _overlayCanvas.width  = W;
  _overlayCanvas.height = H;
  const oc = _overlayCanvas.getContext('2d');
  oc.clearRect(0, 0, W, H);
  if (!fullRoi) return;

  const { x, y, w, h } = fullRoi;
  const color  = found ? '#00ff88' : '#ffdd00';
  const corner = 18;

  oc.strokeStyle = color;
  oc.lineWidth   = 3;
  oc.shadowColor = color;
  oc.shadowBlur  = 8;
  oc.lineCap     = 'round';

  // 코너 마커
  const corners = [
    [x,   y,   1,  1],
    [x+w, y,  -1,  1],
    [x,   y+h, 1, -1],
    [x+w, y+h,-1, -1],
  ];
  corners.forEach(([cx, cy, dx, dy]) => {
    oc.beginPath();
    oc.moveTo(cx + dx*corner, cy);
    oc.lineTo(cx, cy);
    oc.lineTo(cx, cy + dy*corner);
    oc.stroke();
  });

  // 확정 시 박스 전체
  if (found && _lockCount >= LOCK_FRAMES) {
    oc.strokeStyle = color;
    oc.lineWidth   = 2;
    oc.setLineDash([6, 4]);
    oc.strokeRect(x, y, w, h);
    oc.setLineDash([]);
  }

  // ㅣ 영역 강조
  oc.strokeStyle = 'rgba(255,220,0,0.8)';
  oc.lineWidth   = 1.5;
  oc.setLineDash([3, 3]);
  oc.strokeRect(x + w*0.84, y, w*0.13, h);
  oc.setLineDash([]);
}

// ── 픽셀 유틸 ────────────────────────────────────────────────
function _avgColor(ctx, { x, y, w, h }) {
  const ix=Math.round(x), iy=Math.round(y);
  const iw=Math.max(1,Math.round(w)), ih=Math.max(1,Math.round(h));
  const d = ctx.getImageData(ix, iy, iw, ih).data;
  let r=0,g=0,b=0,n=0;
  for (let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
  return n ? {r:r/n,g:g/n,b:b/n} : {r:0,g:0,b:0};
}

function _sampleRegion(ctx, { x, y, w, h }, step=3) {
  const ix=Math.round(x), iy=Math.round(y);
  const iw=Math.max(1,Math.round(w)), ih=Math.max(1,Math.round(h));
  const d=ctx.getImageData(ix,iy,iw,ih).data;
  const samples=[];
  for (let i=0;i<d.length;i+=4*step) samples.push({r:d[i],g:d[i+1],b:d[i+2]});
  return samples;
}

// ── 비프음 ────────────────────────────────────────────────────
function _playBeep() {
  try {
    const ac  = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.18, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
    osc.start(); osc.stop(ac.currentTime + 0.12);
  } catch {}
}

function _status(msg) { _onStatus?.(msg); }

// ── L1 프로필 조회 ───────────────────────────────────────────
export async function lookupProfile(shortId, version) {
  const sid = shortId.toString();

  // ── 로컬 테이블 우선 (L1 없이도 즉시 응답) ──
  // v2.2: 키를 디코더가 실제로 만들어내는 10진수 shortId 문자열로 수정.
  // 이전 키('5zvxrthQVkz')는 프로필 페이지 URL 슬러그였을 뿐, shortId.toString()
  // 형식(순수 숫자)과 달라서 절대 매칭될 수 없는 죽은 코드였다.
  const LOCAL = {
    '2577410713': {
      guid: 'hondi-ai', handle: 'hondi', name: '혼디',
      url: '/profiles/5zvxrthQVkz.html'
    },
  };
  if (LOCAL[sid]) return LOCAL[sid];

  // ── L1 조회 (hondi_code_id 컬럼 시도 → 없으면 handle 로 fallback) ──
  try {
    const base = L1_URL.replace('/api/collections/profiles/records', '');
    // 시도 1: hondi_code_id 필드
    let res = await fetch(
      `${base}/api/collections/profiles/records?filter=(hondi_code_id='${sid}')&perPage=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    // 400 = 컬럼 없음 → handle 로 재시도
    if (res.status === 400) {
      res = await fetch(
        `${base}/api/collections/profiles/records?filter=(handle='${sid}')&perPage=1`,
        { signal: AbortSignal.timeout(5000) }
      );
    }
    if (!res.ok) throw new Error(`L1 응답 오류: ${res.status}`);
    const data = await res.json();
    if (!data.items?.length) throw new Error(`등록되지 않은 혼디 코드입니다. (ID: ${sid}, ${version})`);
    const p = data.items[0];
    return {
      guid: p.ipv6 || p.id,
      handle: p.handle,
      name: p.name || p.nickname || p.handle,
      url: p.hondi_code_id
        ? `/profiles/${p.hondi_code_id}.html`
        : `https://hondi.net/profile?id=${p.id}`,
    };
  } catch (e) {
    throw new Error(`프로필 조회 실패: ${e.message}`);
  }
}
