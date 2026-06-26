/**
 * hondi-scanner.js — 혼디 시각 코드 스캐너 v5.0
 *
 * ══════════════════════════════════════════════════════════════
 * v5.0 핵심 원칙: 위치 먼저, 색상 나중
 * ══════════════════════════════════════════════════════════════
 *
 * [파이프라인]
 *   1. 파랑 원 + 빨강 점 탐지 → 혼디 코드 존재 확인
 *   2. 고채도 세로 구간 탐지 → 색상 막대 X·Y 범위 확정
 *   3. 10칸 균등 분할 → 각 셀 위치 확정
 *   4. 각 셀 색상 읽기 → 팔레트 매칭
 *
 * [장점]
 *   - 로고 크기와 무관 (비율 기반)
 *   - 좌표계 계산 불필요
 *   - 막대를 직접 찾으므로 오프셋 오차 없음
 */

import {
  detectVersion, buildCalibMatrix, applyCalib,
  rgbToIndex, indicesToId,
} from './hondi-code.js';
import { L1_URL } from '../core/state.js';

// ── 상수 ──────────────────────────────────────────────────────
const SCAN_FPS      = 15;
const SCAN_MS       = Math.round(1000 / SCAN_FPS);
const THUMB_SCALE   = 0.25;
const LOCK_FRAMES   = 3;
const ROWS          = 10;

// 색상 막대 탐지 파라미터
const SAT_THRESHOLD  = 60;   // 고채도 판정 (완화: 모니터 카메라 환경)
const COL_VIVID_RATIO= 0.15; // 열의 15% 이상이 고채도면 막대 열 후보 (완화)
const MIN_STRIP_RATIO= 3.0;  // 막대의 최소 세로/가로 비율
const MIN_STRIP_W_RATIO = 0.01; // 막대 너비 최소 (이미지 너비의 1%)
const MAX_STRIP_W_RATIO = 0.15; // 막대 너비 최대 (이미지 너비의 15%)
const CELL_SAMPLE   = 0.6;   // 셀 내부 샘플 비율 (경계선 제외)

// 파랑/빨강 앵커 필터
const MIN_ANCHOR_PX = 4;     // 썸네일 기준 최소 픽셀 수
const MIN_UNIT_PX   = 8;     // 썸네일 기준 최소 unit

// ── 팔레트 ────────────────────────────────────────────────────
// hondi-code.js의 PALETTE와 동기화 필요
const SCAN_PALETTE = [
  { idx:0, r:255, g:255, b:255 }, // 무색
  { idx:1, r:220, g:  0, b:  0 }, // 빨강
  { idx:2, r:255, g:110, b:  0 }, // 주황
  { idx:3, r:255, g:235, b:  0 }, // 노랑
  { idx:4, r:  0, g:185, b:  0 }, // 초록
  { idx:5, r:  0, g:  0, b:220 }, // 파랑
  { idx:6, r:  0, g:  0, b:180 }, // 남색
  { idx:7, r:180, g:  0, b:180 }, // 보라
  { idx:8, r: 30, g: 30, b: 30 }, // 흑색
];

// ── 상태 ──────────────────────────────────────────────────────
let _stream        = null;
let _rafId         = null;
let _lastTime      = 0;
let _lockCount     = 0;
let _lastId        = null;
let _locked        = false;
let _onResult      = null;
let _onStatus      = null;
let _overlayCanvas = null;

// ── 공개 API ──────────────────────────────────────────────────
export async function startScanner(video, canvas, overlayCanvas, onResult, onStatus) {
  _onResult = onResult; _onStatus = onStatus; _overlayCanvas = overlayCanvas;
  _lockCount = 0; _lastId = null; _locked = false;
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} },
      audio: false,
    });
    video.srcObject = _stream;
    await video.play();
    _status('혼디 코드를 화면에 맞춰주세요.');
    _scheduleFrame(video, canvas);
  } catch(e) {
    const msg =
      e.name==='NotAllowedError'  ? '카메라 권한이 거부됐습니다. 설정에서 허용해 주세요.' :
      e.name==='NotFoundError'    ? '카메라를 찾을 수 없습니다.' :
      e.name==='NotReadableError' ? '카메라가 다른 앱에서 사용 중입니다.' :
                                    `카메라 오류: ${e.message}`;
    _status(msg); throw e;
  }
}

export function stopScanner() {
  if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

export function analyzePhoto(imageData, onResult, onStatus) {
  _onResult = onResult; _onStatus = onStatus;
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  const ctx = c.getContext('2d', { willReadFrequently:true });
  ctx.putImageData(imageData, 0, 0);
  const result = _analyzeFrame(ctx, c.width, c.height);
  if (result) _onResult?.(result.shortId, result.version);
  else _onStatus?.('인식 실패. 더 가까이 대주세요.');
}

// ── rAF 루프 ──────────────────────────────────────────────────
function _scheduleFrame(video, canvas) {
  _rafId = requestAnimationFrame(ts => {
    if (_locked) return;
    if (ts - _lastTime >= SCAN_MS) { _lastTime = ts; _processFrame(video, canvas); }
    _scheduleFrame(video, canvas);
  });
}

function _processFrame(video, canvas) {
  if (video.readyState < 2) return;
  const W = video.videoWidth, H = video.videoHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(video, 0, 0);
  const result = _analyzeFrame(ctx, W, H);
  _drawOverlay(result, W, H);
  if (!result) { _lockCount = 0; _lastId = null; return; }

  const idStr = result.shortId.toString();
  if (idStr === _lastId) _lockCount++; else { _lockCount=1; _lastId=idStr; }
  _status(`인식 중... ${Math.round(_lockCount/LOCK_FRAMES*100)}%`);

  if (_lockCount >= LOCK_FRAMES) {
    _locked = true;
    stopScanner();
    if (navigator.vibrate) navigator.vibrate([60,30,60]);
    _playBeep();
    _onResult?.(result.shortId, result.version);
  }
}

// ── 프레임 분석 ───────────────────────────────────────────────
function _analyzeFrame(ctx, W, H) {
  // 썸네일에서 파랑+빨강 앵커 확인 (혼디 코드 존재 검증)
  const tW = Math.round(W * THUMB_SCALE);
  const tH = Math.round(H * THUMB_SCALE);
  const tCtx = _makeThumb(ctx, W, H, tW, tH);
  const anchor = _detectAnchors(tCtx, tW, tH);
  if (!anchor) return null;

  // 원본에서 색상 막대 탐지
  const strip = _detectStrip(ctx, W, H);
  if (!strip) return null;

  // 버전 판별 + 색상 읽기
  return _decode(ctx, strip, anchor);
}

// ── 1단계: 파랑+빨강 앵커 탐지 (혼디 코드 존재 확인) ─────────
function _detectAnchors(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;
  let blueCnt = 0, redCnt = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r=data[i], g=data[i+1], b=data[i+2];
    if (b>80 && b-Math.max(r,g)>30) blueCnt++;   // 완화: 모니터 과노출 대응
    if (r>100 && g<80  && b<130 && r-Math.max(g,b)>30) redCnt++;
  }
  if (blueCnt < MIN_ANCHOR_PX || redCnt < MIN_ANCHOR_PX) return null;

  // 파랑/빨강 중심 계산
  let bx=0,by=0,rx=0,ry=0;
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    const i=(y*W+x)*4;
    const r=data[i],g=data[i+1],b=data[i+2];
    if (b>80&&b-Math.max(r,g)>30) { bx+=x; by+=y; }
    if (r>100&&g<80&&b<130&&r-Math.max(g,b)>30) { rx+=x; ry+=y; }
  }
  bx/=blueCnt; by/=blueCnt; rx/=redCnt; ry/=redCnt;
  const unit = Math.sqrt((rx-bx)**2+(ry-by)**2);
  if (unit < MIN_UNIT_PX) return null;

  // 파랑이 위, 빨강이 아래인지 확인 (UCB는 반대일 수 있음)
  const mode = (by < ry) ? 'hondi' : 'ucb';
  return { mode, blueCenter:{x:bx,y:by}, redCenter:{x:rx,y:ry}, unit,
           blueCnt, redCnt };
}

// ── 2단계: 색상 막대 탐지 ────────────────────────────────────
// 핵심: 고채도 픽셀이 세로로 길게 연속된 구간 = 색상 막대
function _detectStrip(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;

  // 열별 고채도 픽셀 수 집계
  const colVivid = new Int32Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y*W+x)*4;
      const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
      if (a < 128) continue;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
      if (mx-mn > SAT_THRESHOLD) colVivid[x]++;
    }
  }

  // 고채도 열 구간 찾기
  const threshold = H * COL_VIVID_RATIO;
  const vividMask = new Uint8Array(W);
  for (let x=0; x<W; x++) if (colVivid[x] > threshold) vividMask[x]=1;

  // 연속 구간 추출 → 세로/가로 비율 가장 높고 너비 기준 이하인 것
  let best = null, bestRatio = 0;
  let start = -1;
  for (let x = 0; x <= W; x++) {
    if (x < W && vividMask[x]) {
      if (start < 0) start = x;
    } else {
      if (start >= 0) {
        const w = x - start;
        if (w >= W * MIN_STRIP_W_RATIO && w < W * MAX_STRIP_W_RATIO) {
          // 이 구간의 Y 범위 확인
          const { y1, y2 } = _stripYRange(data, W, H, start, x-1);
          if (y2 > y1) {
            const h = y2 - y1;
            const ratio = h / w;
            if (ratio > MIN_STRIP_RATIO && ratio > bestRatio) {
              bestRatio = ratio;
              best = { x1:start, x2:x-1, y1, y2, w, h };
            }
          }
        }
        start = -1;
      }
    }
  }

  return best; // { x1, x2, y1, y2, w, h }
}

function _stripYRange(data, W, H, x1, x2) {
  let y1 = H, y2 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = x1; x <= x2; x++) {
      const i = (y*W+x)*4;
      const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
      if (a<128) continue;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
      if (mx-mn > SAT_THRESHOLD) { if(y<y1)y1=y; if(y>y2)y2=y; }
    }
  }
  return { y1, y2 };
}


// ── 캘리브레이션 패치 탐지 및 실제 팔레트 측정 ─────────────
// 색상 막대 아래의 9개 패치를 읽어서 실제 카메라 환경의 색상값을 측정한다.
// 패치가 없으면 기본 SCAN_PALETTE 사용.
function _readCalibPatch(ctx, strip) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sw = strip.w;   // 패치 1개 너비 = 막대 너비
  const gap = sw * 0.2; // 막대 하단과 패치 사이 간격 (비율)
  const py  = strip.y2 + gap;
  const ph  = sw;       // 패치 높이 = 막대 너비 (정사각형)

  // 패치 오른쪽 끝 = 막대 왼쪽 끝
  const patchEndX = strip.x1;
  const patchStartX = patchEndX - sw * 9;

  // 화면 밖이면 캘리브레이션 불가
  if (py + ph > H || patchStartX < 0) return null;

  const realPalette = [];
  for (let i = 0; i < 9; i++) {
    const px = patchStartX + i * sw;
    // 패치 내부 중앙 60% 샘플 (경계선 제외)
    const roi = {
      x: px + sw * 0.1,
      y: py + ph * 0.1,
      w: sw * 0.8,
      h: ph * 0.8,
    };
    const c = _avgColor(ctx, roi);
    realPalette.push({ idx: i, r: c.r, g: c.g, b: c.b });
  }

  // 유효성 검사: 9개 패치가 서로 충분히 다른 색상인지
  // (모두 같은 색이면 패치를 못 읽은 것)
  const rVals = realPalette.map(c => c.r);
  const rRange = Math.max(...rVals) - Math.min(...rVals);
  const gVals = realPalette.map(c => c.g);
  const gRange = Math.max(...gVals) - Math.min(...gVals);
  const bVals = realPalette.map(c => c.b);
  const bRange = Math.max(...bVals) - Math.min(...bVals);

  // 색상 다양성이 충분하지 않으면 캘리브레이션 실패
  if (rRange + gRange + bRange < 200) return null;

  return realPalette;  // 측정된 실제 팔레트
}

// 실제 팔레트로 가장 가까운 색상 인덱스 찾기
function _nearestWithCalib(pixel, palette) {
  let best = 0, bestD = Infinity;
  for (const c of palette) {
    const d = (pixel.r-c.r)**2 + (pixel.g-c.g)**2 + (pixel.b-c.b)**2;
    if (d < bestD) { bestD = d; best = c.idx; }
  }
  return best;
}

// ── 3·4단계: 10칸 분할 → 색상 읽기 ──────────────────────────
function _decode(ctx, strip, anchor) {
  const { x1, x2, y1, y2, h } = strip;
  const cellH = h / ROWS;
  const W = ctx.canvas.width, H = ctx.canvas.height;

  // 캘리브레이션: 파랑·빨강 클러스터 직접 평균 (원본 크기로 스케일)
  const scale = 1 / THUMB_SCALE;
  const bBox = {
    x1: anchor.blueCenter.x*scale - anchor.unit*scale*0.5,
    y1: anchor.blueCenter.y*scale - anchor.unit*scale*0.5,
    x2: anchor.blueCenter.x*scale + anchor.unit*scale*0.5,
    y2: anchor.blueCenter.y*scale + anchor.unit*scale*0.5,
  };
  const rBox = {
    x1: anchor.redCenter.x*scale - anchor.unit*scale*0.5,
    y1: anchor.redCenter.y*scale - anchor.unit*scale*0.5,
    x2: anchor.redCenter.x*scale + anchor.unit*scale*0.5,
    y2: anchor.redCenter.y*scale + anchor.unit*scale*0.5,
  };
  const blueAvg = _clusterAvg(ctx, bBox, true);
  const redAvg  = _clusterAvg(ctx, rBox, false);

  // 배경(흰색)은 막대 바깥 우측에서 샘플
  const bgX = Math.min(W-5, x2 + Math.max(10, strip.w));
  const bgY = y1;
  const bgAvg = _avgColor(ctx, { x:bgX, y:bgY, w:10, h:10 });

  const calib = { hih:blueAvg, ho:redAvg, n:{r:30,g:30,b:30}, bg:bgAvg };
  const matrix = buildCalibMatrix(calib);

  // 버전 판별: v2는 셀이 좌우 2열, v1은 단열
  // 막대 너비가 높이/10의 2배 이상이면 v2
  const version = (strip.w > cellH * 1.5) ? 'v2' : 'v1';

  // 각 셀 색상 읽기
  // 캘리브레이션 패치 읽기 (성공하면 실제 팔레트 사용, 실패하면 기본 팔레트)
  const realPalette = _readCalibPatch(ctx, strip);
  const useCalib = !!realPalette;

  const indices = [];
  if (version === 'v1') {
    for (let row = 0; row < ROWS; row++) {
      const sy = y1 + cellH * row;
      const roi = {
        x: x1 + 1,
        y: sy + cellH * (1-CELL_SAMPLE) / 2,
        w: strip.w - 2,
        h: cellH * CELL_SAMPLE,
      };
      const raw = _avgColor(ctx, roi);
      // 캘리브레이션 패치가 있으면: 실제 측정 팔레트로 직접 비교
      // 없으면: 기존 캘리브레이션 행렬 사용
      indices.push(useCalib
        ? _nearestWithCalib(raw, realPalette)
        : _nearestPalette(applyCalib(raw, matrix)));
    }
  } else {
    const halfW = strip.w / 2;
    for (let row = 0; row < ROWS; row++) {
      const sy = y1 + cellH * row;
      for (let col = 0; col < 2; col++) {
        const roi = {
          x: x1 + col*halfW + 1,
          y: sy + cellH * (1-CELL_SAMPLE) / 2,
          w: halfW - 2,
          h: cellH * CELL_SAMPLE,
        };
        const raw = _avgColor(ctx, roi);
        indices.push(useCalib
          ? _nearestWithCalib(raw, realPalette)
          : _nearestPalette(applyCalib(raw, matrix)));
      }
    }
  }

  const shortId = indicesToId(indices);

  // 전체 흑색 오인식 진단
  if (indices.every(i => i===8)) {
    _showDebugDump({ calib, matrix, strip, version, ua:navigator.userAgent });
  }

  return { shortId, version, strip, anchor };
}

// ── 팔레트 매칭 (캘리브레이션 적용 후) ───────────────────────
function _nearestPalette(pixel) {
  let best=0, bestD=Infinity;
  for (const c of SCAN_PALETTE) {
    const d=(pixel.r-c.r)**2+(pixel.g-c.g)**2+(pixel.b-c.b)**2;
    if (d<bestD) { bestD=d; best=c.idx; }
  }
  return best;
}

// ── 오버레이 ──────────────────────────────────────────────────
function _drawOverlay(result, W, H) {
  if (!_overlayCanvas) return;
  _overlayCanvas.width=W; _overlayCanvas.height=H;
  const oc = _overlayCanvas.getContext('2d');
  oc.clearRect(0,0,W,H);
  if (!result) return;

  const { strip, anchor } = result;
  const scale = 1/THUMB_SCALE;

  // 파랑/빨강 앵커
  const B = { x:anchor.blueCenter.x*scale, y:anchor.blueCenter.y*scale };
  const R = { x:anchor.redCenter.x*scale,  y:anchor.redCenter.y*scale  };
  const unit = anchor.unit * scale;
  const dotR = Math.max(6, unit*0.10);

  oc.strokeStyle='#00ff88'; oc.lineWidth=3;
  oc.shadowColor='#00ff88'; oc.shadowBlur=8;
  oc.beginPath(); oc.arc(B.x,B.y,dotR,0,Math.PI*2); oc.stroke();
  oc.beginPath(); oc.arc(R.x,R.y,dotR,0,Math.PI*2); oc.stroke();
  oc.beginPath(); oc.moveTo(B.x,B.y); oc.lineTo(R.x,R.y); oc.stroke();

  // 색상 막대 박스
  oc.strokeStyle='rgba(255,220,0,0.9)';
  oc.lineWidth=2; oc.shadowBlur=0;
  oc.strokeRect(strip.x1, strip.y1, strip.w, strip.h);

  // 10칸 경계선
  oc.strokeStyle='rgba(255,255,255,0.5)';
  oc.lineWidth=1;
  const cellH = strip.h / ROWS;
  for (let row=1; row<ROWS; row++) {
    const y = strip.y1 + cellH*row;
    oc.beginPath(); oc.moveTo(strip.x1,y); oc.lineTo(strip.x2,y); oc.stroke();
  }
}

// ── 유틸 ──────────────────────────────────────────────────────
function _makeThumb(ctx, W, H, tW, tH) {
  const off = new OffscreenCanvas(tW,tH);
  const oc  = off.getContext('2d',{willReadFrequently:true});
  oc.drawImage(ctx.canvas,0,0,W,H,0,0,tW,tH);
  return oc;
}

function _avgColor(ctx, {x,y,w,h}) {
  const cw=ctx.canvas.width, ch=ctx.canvas.height;
  const ix=Math.max(0,Math.min(cw-1,Math.round(x)));
  const iy=Math.max(0,Math.min(ch-1,Math.round(y)));
  const iw=Math.max(1,Math.min(cw-ix,Math.round(w)));
  const ih=Math.max(1,Math.min(ch-iy,Math.round(h)));
  const d=ctx.getImageData(ix,iy,iw,ih).data;
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
  return n?{r:r/n,g:g/n,b:b/n}:{r:128,g:128,b:128};
}

function _clusterAvg(ctx, box, isBlue) {
  const cw=ctx.canvas.width, ch=ctx.canvas.height;
  const x=Math.max(0,Math.round(box.x1)), y=Math.max(0,Math.round(box.y1));
  const w=Math.max(1,Math.min(cw-x,Math.round(box.x2-box.x1)));
  const h=Math.max(1,Math.min(ch-y,Math.round(box.y2-box.y1)));
  const d=ctx.getImageData(x,y,w,h).data;
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){
    const pr=d[i],pg=d[i+1],pb=d[i+2];
    if(isBlue){if(pb>100&&pr<110&&pg<110&&pb-Math.max(pr,pg)>40){r+=pr;g+=pg;b+=pb;n++;}}
    else      {if(pr>100&&pg<50 &&pb<110&&pr-Math.max(pg,pb)>40){r+=pr;g+=pg;b+=pb;n++;}}
  }
  return n?{r:r/n,g:g/n,b:b/n}:(isBlue?{r:0,g:0,b:220}:{r:220,g:0,b:0});
}

function _playBeep() {
  try {
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ac.createOscillator(),gain=ac.createGain();
    osc.connect(gain);gain.connect(ac.destination);
    osc.frequency.value=1320;
    gain.gain.setValueAtTime(0.18,ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    osc.start();osc.stop(ac.currentTime+0.12);
  }catch{}
}

function _showDebugDump(data) {
  try {
    let el=document.getElementById('hs-debug-dump');
    if(!el){el=document.createElement('div');el.id='hs-debug-dump';
      el.style.cssText='position:fixed;left:10px;right:10px;bottom:10px;z-index:999999;background:#111;color:#7CFC8A;font:11px/1.45 monospace;padding:12px;border-radius:12px;max-height:42vh;overflow:auto';
      document.body.appendChild(el);}
    el.innerHTML='';
    const text=JSON.stringify(data,(k,v)=>typeof v==='bigint'?v.toString():v,2);
    const title=document.createElement('div');title.textContent='🩺 스캐너 v5.0 진단';
    title.style.cssText='color:#fff;font-weight:bold;margin-bottom:8px';
    const pre=document.createElement('pre');pre.style.cssText='margin:0 0 10px;white-space:pre-wrap;word-break:break-all';pre.textContent=text;
    const row=document.createElement('div');row.style.display='flex';
    const copyBtn=document.createElement('button');
    copyBtn.textContent='📋 복사';copyBtn.style.cssText='flex:1;padding:8px;border-radius:8px;border:none;background:#7CFC8A;color:#102010;font-weight:bold;margin-right:8px';
    copyBtn.onclick=async()=>{try{await navigator.clipboard.writeText(text);copyBtn.textContent='✅';}catch(e){copyBtn.textContent='❌';}};
    const closeBtn=document.createElement('button');closeBtn.textContent='닫기';
    closeBtn.style.cssText='padding:8px 16px;border-radius:8px;border:none;background:#333;color:#fff';
    closeBtn.onclick=()=>el.remove();
    row.appendChild(copyBtn);row.appendChild(closeBtn);
    el.appendChild(title);el.appendChild(pre);el.appendChild(row);
  }catch(e){console.error(e);}
}

function _status(msg){_onStatus?.(msg);}

// ── L1 프로필 조회 ───────────────────────────────────────────
export async function lookupProfile(shortId, version) {
  const sid=shortId.toString();
  const LOCAL={
    '2577410713':{guid:'hondi-ai',handle:'hondi',name:'혼디',url:'/profiles/5zvxrthQVkz.html'},
    '2537012854':{guid:'hondi-ai',handle:'hondi',name:'혼디',url:'/profiles/2537012854.html'},
  };
  if(LOCAL[sid]) return LOCAL[sid];
  try{
    const base=L1_URL.replace('/api/collections/profiles/records','');
    let res=await fetch(`${base}/api/collections/profiles/records?filter=(hondi_code_id='${sid}')&perPage=1`,{signal:AbortSignal.timeout(5000)});
    if(res.status===400) res=await fetch(`${base}/api/collections/profiles/records?filter=(handle='${sid}')&perPage=1`,{signal:AbortSignal.timeout(5000)});
    if(!res.ok) throw new Error(`L1 오류: ${res.status}`);
    const data=await res.json();
    if(!data.items?.length) throw new Error(`등록되지 않은 코드 (${sid})`);
    const p=data.items[0];
    return{guid:p.ipv6||p.id,handle:p.handle,name:p.name||p.nickname||p.handle,
           url:p.hondi_code_id?`/profiles/${p.hondi_code_id}.html`:`https://hondi.net/profile?id=${p.id}`};
  }catch(e){throw new Error(`프로필 조회 실패: ${e.message}`);}
}
