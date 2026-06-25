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
const LOCK_FRAMES     = 4;    // 일반 환경; 야간은 _setNightMode()로 6으로 상향                       // 연속 N프레임 일치로 확정
const MIN_GLYPH_H     = 16;   // 썸네일 기준 → 실제 64px → 최대 ~2.9m 인식                      // 썸네일 기준 최소 높이(px)
const ASPECT_MIN      = 1.4;                     // "혼디" 글자 최소 가로/세로 비율
const ASPECT_MAX      = 3.5;                     // 최대 가로/세로 비율

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

  const pct = Math.round(_lockCount / LOCK_FRAMES * 100);
  _status(`인식 중... ${pct}% [${result.version}]`);

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

  return { shortId, version, roi: fullRoi };
}

// ── 썸네일 생성 ───────────────────────────────────────────────
function _makeThumb(ctx, W, H, tW, tH) {
  const off = new OffscreenCanvas(tW, tH);
  const oc  = off.getContext('2d', { willReadFrequently: true });
  oc.drawImage(ctx.canvas, 0, 0, W, H, 0, 0, tW, tH);
  return oc;
}

// ── "혼디" 글자 ROI 탐지 ─────────────────────────────────────
function _detectHondiROI(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;

  let blueX = [], blueY = [], redX = [], redY = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];

      // ㅎ 파랑: b 우세
      if (b > 120 && r < 90 && g < 90 && b - Math.max(r,g) > 60) {
        blueX.push(x); blueY.push(y);
      }
      // ㅗ 빨강: r 우세
      if (r > 120 && g < 90 && b < 90 && r - Math.max(g,b) > 60) {
        redX.push(x); redY.push(y);
      }
    }
  }

  if (blueX.length < 8 || redX.length < 8) return null;

  // 전체 바운딩 박스
  const allX = [...blueX, ...redX];
  const allY = [...blueY, ...redY];
  const x1 = Math.min(...allX), x2 = Math.max(...allX);
  const y1 = Math.min(...allY), y2 = Math.max(...allY);
  const gW = x2 - x1, gH = y2 - y1;

  if (gH < MIN_GLYPH_H) return null;

  // 종횡비 검증 — "혼디" 글자는 가로가 세로보다 넓음
  const aspect = gW / gH;
  if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) return null;

  // 자모별 ROI (비율 기반)
  const midX = x1 + gW * 0.52;   // ㅣ는 오른쪽 끝

  return {
    full: { x: x1, y: y1, w: gW, h: gH },
    hih:  { x: x1,         y: y1,           w: gW*0.38, h: gH*0.38 },  // ㅎ
    ho:   { x: x1+gW*0.08, y: y1+gH*0.30,  w: gW*0.28, h: gH*0.20 },  // ㅗ
    n:    { x: x1,         y: y1+gH*0.72,  w: gW*0.38, h: gH*0.20 },  // ㄴ
    bg:   { x: Math.max(0,x1-20), y: y1,   w: 14,      h: 14       },  // 배경
    d:    { x: midX,       y: y1+gH*0.08,  w: gW*0.38, h: gH*0.70 },  // ㄷ
    i:    { x: midX+gW*0.32, y: y1,        w: gW*0.13, h: gH       },  // ㅣ
  };
}

function _scaleRoi(roi, s) {
  const sc = r => ({ x:r.x*s, y:r.y*s, w:r.w*s, h:r.h*s });
  return {
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
  try {
    const base = L1_URL.replace('/api/collections/profiles/records', '');
    const res = await fetch(
      `${base}/api/collections/profiles/records?filter=(hondi_code_id='${shortId.toString()}')&perPage=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`L1 응답 오류: ${res.status}`);
    const data = await res.json();
    if (!data.items?.length) throw new Error('등록되지 않은 혼디 코드입니다.');
    const p = data.items[0];
    return { guid:p.ipv6||p.id, handle:p.handle, name:p.name,
             url:`https://gopang.net/profile?id=${p.id}` };
  } catch (e) {
    throw new Error(`프로필 조회 실패: ${e.message}`);
  }
}
