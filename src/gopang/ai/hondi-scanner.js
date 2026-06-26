/**
 * hondi-scanner.js — 혼디 시각 코드 스캐너 v3.0
 *
 * ══════════════════════════════════════════════════════════════
 * v3.0 근본 재설계 (2026-06) — "두 앵커 좌표계"
 * ══════════════════════════════════════════════════════════════
 *
 * [이전 버전 근본 결함]
 *   파랑(ㅎ)+빨강(ㅗ) 픽셀 전체 bbox를 기준으로 ROI 비율을 계산했음.
 *   이 bbox는 글자 왼쪽(ㅎ+ㅗ)만 포함하므로, ㄷ·ㅣ 등 오른쪽 요소의
 *   ROI가 항상 전혀 다른 위치(화면 중앙~오른쪽 임의 픽셀)를 가리켰다.
 *   → bg가 (0,0,0) → darkOffset=162 → 전 칸 흑색 오인식의 근본 원인.
 *
 * [v3.0 해결책: 두 앵커(ㅎ·ㅗ) 기반 좌표계]
 *   O    = blueCenter (파랑 클러스터 중심 = ㅎ)     ← 원점
 *   E    = redCenter  (빨강 클러스터 중심 = ㅗ)
 *   unit = |E - O|                                ← 기준 단위
 *   Un   = (E - O) / unit                         ← along 방향
 *   Up   = Un 좌회전 90°                           ← perp 방향
 *
 *   임의 점 P = O + along·unit·Un + perp·unit·Up
 *
 *   글자 크기·위치·기울기와 무관하게 항상 동일한 상대 위치를 가리킴.
 *
 * [오프셋 상수 실측]
 *   베이스 이미지 /icons/hondi-base-hond.png (680×542) 직접 픽셀 분석:
 *     blueCenter=(136.6,144.3)  redCenter=(134.9,334.5)  unit=190.2px
 *   STRIP 정보 (hondi-code.js): STRIP_X=705,STRIP_Y=15,STRIP_W=65,STRIP_H=512
 *
 * [캘리브레이션 개선]
 *   hih(ㅎ=파랑): 파랑 클러스터 픽셀 직접 평균 (ROI 영역 샘플 아님 → 정확)
 *   ho (ㅗ=빨강): 빨강 클러스터 픽셀 직접 평균
 *   n  (ㄴ=검정): 앵커 좌표계로 정확히 계산한 ROI 샘플
 *   bg (배경=흰): 색상 막대 오른쪽 바깥 → 항상 배경 영역
 */

import {
  detectVersion, buildCalibMatrix, applyCalib,
  rgbToIndex, indicesToId,
} from './hondi-code.js';
import { L1_URL } from '../core/state.js';

// ── 상수 ──────────────────────────────────────────────────────
const SCAN_FPS    = 15;
const SCAN_MS     = Math.round(1000 / SCAN_FPS);
const THUMB_SCALE = 0.25;
const LOCK_FRAMES = 3;
const MIN_UNIT_PX = 10;   // 썸네일 기준 unit(ㅎ→ㅗ) 최소값

// UCB 모드 판별: 파랑+빨강 bbox 종횡비 < 이 값이면 세로 배열(UCB)
const UCB_ASPECT_MAX = 0.55;

// ── 앵커 기반 ROI 오프셋 (실측, unit 단위) ───────────────────
// 기준: blueCenter=원점, Un=ㅎ→ㅗ 방향, Up=Un 좌회전(화면 오른쪽 = 음수)
// 실측: 베이스 이미지 680×542, 2026-06 픽셀 직접 분석
const AO = {
  // [along, perp]
  n:          [ 1.755,  0.106],   // ㄴ 검정 중심
  d:          [ 0.062, -2.114],   // ㄷ 검정 중심 (버전 판별용)
  strip_top:  [-0.708, -3.153],   // 색상 막대(ㅣ) 상단 중심
  strip_bot:  [ 1.984, -3.177],   // 색상 막대(ㅣ) 하단 중심
  bg:         [-0.710, -3.416],   // 배경 흰색 (막대 오른쪽 바깥)
};
const SAMPLE_W  = 0.21;    // 캘리브레이션 샘플 너비 (unit 단위)
const SAMPLE_H  = 0.16;    // 캘리브레이션 샘플 높이 (unit 단위)
const STRIP_W_U = 0.342;   // 색상 막대 너비 (unit 단위, STRIP_W/unit ≈ 65/190)

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
  _onResult      = onResult;
  _onStatus      = onStatus;
  _overlayCanvas = overlayCanvas;
  _lockCount     = 0;
  _lastId        = null;
  _locked        = false;

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = _stream;
    await video.play();
    _status('혼디 글자를 화면에 맞춰주세요.');
    _scheduleFrame(video, canvas);
  } catch (e) {
    let msg;
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      msg = '카메라 권한이 거부됐습니다.\n브라우저 주소창 왼쪽 🔒 → 카메라 허용 후 다시 시도해 주세요.';
    } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
      msg = '카메라를 찾을 수 없습니다.';
    } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
      msg = '카메라가 다른 앱에서 사용 중입니다.';
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

export function analyzePhoto(imageData, onResult, onStatus) {
  _onResult = onResult;
  _onStatus = onStatus;
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width; canvas.height = imageData.height;
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
    if (_locked) return;
    if (ts - _lastTime >= SCAN_MS) { _lastTime = ts; _processFrame(video, canvas); }
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
  _drawOverlay(result?.anchorInfo, W, H, !!result);

  if (!result) { _lockCount = 0; _lastId = null; return; }

  const idStr = result.shortId.toString();
  if (idStr === _lastId) { _lockCount++; } else { _lockCount = 1; _lastId = idStr; }

  const pct = Math.round(_lockCount / LOCK_FRAMES * 100);
  _status(`인식 중... ${pct}% [${result.anchorInfo.mode === 'ucb' ? 'UCB' : '혼디'} ${result.version}]`);

  if (_lockCount >= LOCK_FRAMES) {
    _locked = true;
    stopScanner();
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    _playBeep();
    _onResult?.(result.shortId, result.version);
  }
}

// ── 프레임 분석 ───────────────────────────────────────────────
function _analyzeFrame(ctx, W, H) {
  const tW = Math.round(W * THUMB_SCALE);
  const tH = Math.round(H * THUMB_SCALE);
  const thumbCtx = _makeThumb(ctx, W, H, tW, tH);
  const thumbAnchor = _detectAnchors(thumbCtx, tW, tH);
  if (!thumbAnchor) return null;

  const anchor = _scaleAnchor(thumbAnchor, 1 / THUMB_SCALE);

  if (anchor.mode === 'ucb') return _decodeUCB(ctx, anchor);
  return _decodeHondi(ctx, anchor);
}

// ── 앵커 탐지 ─────────────────────────────────────────────────
function _detectAnchors(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;
  const blueMask = new Uint8Array(W * H);
  const redMask  = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const px = y * W + x;
      if (b>100 && r<110 && g<110 && b-Math.max(r,g)>40) { blueMask[px]=1; }
      if (r>100 && g<50  && b<110 && r-Math.max(g,b)>40) { redMask[px]=1;  }
    }
  }

  if (_maskCount(blueMask) < 4 || _maskCount(redMask) < 4) return null;

  const blueBox = _largestComponentBbox(blueMask, W, H);
  const redBox  = _largestComponentBbox(redMask,  W, H);
  if (!blueBox || !redBox) return null;

  const blueCenter = _componentCenter(blueMask, blueBox, W);
  const redCenter  = _componentCenter(redMask,  redBox,  W);

  const dx = redCenter.x - blueCenter.x;
  const dy = redCenter.y - blueCenter.y;
  const unit = Math.sqrt(dx*dx + dy*dy);
  if (unit < MIN_UNIT_PX) return null;

  // 모드 판별: 두 클러스터 합산 bbox 종횡비
  const x1 = Math.min(blueBox.x1, redBox.x1);
  const y1 = Math.min(blueBox.y1, redBox.y1);
  const gW = Math.max(blueBox.x2, redBox.x2) - x1;
  const gH = Math.max(blueBox.y2, redBox.y2) - y1;
  const aspect = gH > 0 ? gW / gH : 999;
  const mode = aspect < UCB_ASPECT_MAX ? 'ucb' : 'hondi';

  return { mode, blueCenter, redCenter, unit, blueBox, redBox };
}

// ── 혼디 코드 디코딩 ──────────────────────────────────────────
function _decodeHondi(ctx, anchor) {
  // hih/ho: 클러스터 픽셀 직접 평균 (ROI 샘플 대신 → 정확)
  const blueAvg = _clusterAvg(ctx, anchor.blueBox, true);
  const redAvg  = _clusterAvg(ctx, anchor.redBox,  false);

  const calib = {
    hih: blueAvg,
    ho:  redAvg,
    n:   _avgColor(ctx, _anchorRect(anchor, AO.n[0],  AO.n[1],  SAMPLE_W,      SAMPLE_H)),
    bg:  _avgColor(ctx, _anchorRect(anchor, AO.bg[0], AO.bg[1], SAMPLE_W,      SAMPLE_H)),
  };
  const matrix = buildCalibMatrix(calib);

  const dRect    = _anchorRect(anchor, AO.d[0], AO.d[1], SAMPLE_W * 1.5, SAMPLE_H * 2);
  const dSamples = _sampleRegion(ctx, dRect);
  const version  = detectVersion(dSamples);

  const iRoi    = _stripRoi(anchor);
  const indices = _extractIndices(ctx, iRoi, version, matrix);
  const shortId = indicesToId(indices);

  if (indices.every(i => i === 8)) {
    const dbg = { calib, matrix, iRoi, anchorUnit: anchor.unit, ua: navigator.userAgent };
    console.warn('[혼디스캐너 v3] 전체 흑색 오인식:', dbg);
    _showDebugDump(dbg);
  }

  return { shortId, version, anchorInfo: anchor };
}

// ── UCB 디코딩 ───────────────────────────────────────────────
function _decodeUCB(ctx, anchor) {
  const { blueCenter: B, redCenter: R, unit } = anchor;
  const topY = Math.min(B.y, R.y), botY = Math.max(B.y, R.y);
  const barH = botY - topY;
  const dotSz = Math.max(6, unit * 0.8);
  const barCX = (B.x + R.x) / 2;
  const barW  = Math.max(6, unit * 0.6);

  const hihRoi = { x: barCX-dotSz/2, y: topY-dotSz/2, w: dotSz, h: dotSz };
  const hoRoi  = { x: barCX-dotSz/2, y: botY-dotSz/2, w: dotSz, h: dotSz };
  const bgRoi  = { x: Math.max(0, barCX-barW-12), y: topY, w: 10, h: 10 };
  const dRoi   = { x: barCX-barW/2, y: topY+barH*0.3, w: barW, h: barH*0.4 };
  const iRoi   = { x: barCX-barW/2, y: topY, w: barW, h: barH };

  const calib = {
    hih: _avgColor(ctx, hihRoi), ho: _avgColor(ctx, hoRoi),
    n: _avgColor(ctx, bgRoi), bg: _avgColor(ctx, bgRoi),
  };
  const matrix   = buildCalibMatrix(calib);
  const dSamples = _sampleRegion(ctx, dRoi);
  const version  = detectVersion(dSamples);
  const indices  = _extractIndices(ctx, iRoi, version, matrix);
  const shortId  = indicesToId(indices);

  return { shortId, version, anchorInfo: anchor };
}

// ── 좌표계 헬퍼 ───────────────────────────────────────────────

function _anchorToXY(anchor, along, perp) {
  const { blueCenter: O, redCenter: E, unit } = anchor;
  const Ux = (E.x-O.x)/unit, Uy = (E.y-O.y)/unit;
  const Px = -Uy, Py = Ux;
  return {
    x: O.x + along*unit*Ux + perp*unit*Px,
    y: O.y + along*unit*Uy + perp*unit*Py,
  };
}

function _anchorRect(anchor, along, perp, wU, hU) {
  const c = _anchorToXY(anchor, along, perp);
  const hw = wU*anchor.unit/2, hh = hU*anchor.unit/2;
  return { x: c.x-hw, y: c.y-hh, w: wU*anchor.unit, h: hU*anchor.unit };
}

function _stripRoi(anchor) {
  const top = _anchorToXY(anchor, AO.strip_top[0], AO.strip_top[1]);
  const bot = _anchorToXY(anchor, AO.strip_bot[0], AO.strip_bot[1]);
  const h  = Math.abs(bot.y - top.y);
  const cx = (top.x + bot.x) / 2;
  const w  = STRIP_W_U * anchor.unit;
  return { x: cx-w/2, y: Math.min(top.y, bot.y), w, h };
}

function _scaleAnchor(a, s) {
  const sp = p => ({ x: p.x*s, y: p.y*s });
  const sb = b => ({ x1: b.x1*s, y1: b.y1*s, x2: b.x2*s, y2: b.y2*s, size: b.size });
  return {
    mode: a.mode, unit: a.unit*s,
    blueCenter: sp(a.blueCenter), redCenter: sp(a.redCenter),
    blueBox: sb(a.blueBox), redBox: sb(a.redBox),
  };
}

// ── 연결요소 BFS ──────────────────────────────────────────────
function _largestComponentBbox(mask, W, H) {
  const visited=new Uint8Array(W*H);
  const qx=new Int32Array(W*H), qy=new Int32Array(W*H);
  let best=null, bestSize=0;
  for (let sy=0; sy<H; sy++) {
    for (let sx=0; sx<W; sx++) {
      const sIdx=sy*W+sx;
      if (!mask[sIdx]||visited[sIdx]) continue;
      let head=0,tail=0;
      qx[tail]=sx;qy[tail]=sy;tail++;visited[sIdx]=1;
      let bx1=sx,by1=sy,bx2=sx,by2=sy,size=0;
      while (head<tail) {
        const cx=qx[head],cy=qy[head];head++;size++;
        if(cx<bx1)bx1=cx;if(cx>bx2)bx2=cx;
        if(cy<by1)by1=cy;if(cy>by2)by2=cy;
        for (const [nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
          if(nx<0||nx>=W||ny<0||ny>=H) continue;
          const ni=ny*W+nx;
          if(mask[ni]&&!visited[ni]){visited[ni]=1;qx[tail]=nx;qy[tail]=ny;tail++;}
        }
      }
      if(size>bestSize){bestSize=size;best={x1:bx1,y1:by1,x2:bx2,y2:by2,size};}
    }
  }
  return best;
}

function _componentCenter(mask, bbox, W) {
  let sx=0,sy=0,n=0;
  for (let y=bbox.y1;y<=bbox.y2;y++)
    for (let x=bbox.x1;x<=bbox.x2;x++)
      if(mask[y*W+x]){sx+=x;sy+=y;n++;}
  return n ? {x:sx/n,y:sy/n} : {x:(bbox.x1+bbox.x2)/2,y:(bbox.y1+bbox.y2)/2};
}

function _maskCount(mask) { let n=0; for(let i=0;i<mask.length;i++) if(mask[i])n++; return n; }

// ── 클러스터 픽셀 직접 평균 (캘리브레이션용) ─────────────────
function _clusterAvg(ctx, box, isBlue) {
  const x=Math.round(box.x1),y=Math.round(box.y1);
  const w=Math.max(1,Math.round(box.x2-box.x1)),h=Math.max(1,Math.round(box.y2-box.y1));
  const d=ctx.getImageData(x,y,w,h).data;
  let r=0,g=0,b=0,n=0;
  for (let i=0;i<d.length;i+=4) {
    const pr=d[i],pg=d[i+1],pb=d[i+2];
    if (isBlue) {
      if(pb>100&&pr<110&&pg<110&&pb-Math.max(pr,pg)>40){r+=pr;g+=pg;b+=pb;n++;}
    } else {
      if(pr>100&&pg<50&&pb<110&&pr-Math.max(pg,pb)>40){r+=pr;g+=pg;b+=pb;n++;}
    }
  }
  return n ? {r:r/n,g:g/n,b:b/n} : (isBlue ? {r:0,g:0,b:220} : {r:220,g:0,b:0});
}

// ── ㅣ → 색상 인덱스 ────────────────────────────────────────
function _extractIndices(ctx, iRoi, version, matrix) {
  const ROWS=10, cellH=iRoi.h/ROWS;
  const indices=[];
  if (version==='v1') {
    for(let row=0;row<ROWS;row++){
      const raw=_avgColor(ctx,{x:iRoi.x,y:iRoi.y+row*cellH,w:iRoi.w,h:cellH});
      indices.push(rgbToIndex(applyCalib(raw,matrix)));
    }
  } else {
    const halfW=iRoi.w/2;
    for(let row=0;row<ROWS;row++){
      const y=iRoi.y+row*cellH;
      for(let col=0;col<2;col++){
        const raw=_avgColor(ctx,{x:iRoi.x+col*halfW,y,w:halfW,h:cellH});
        indices.push(rgbToIndex(applyCalib(raw,matrix)));
      }
    }
  }
  return indices;
}

// ── 썸네일 생성 ───────────────────────────────────────────────
function _makeThumb(ctx, W, H, tW, tH) {
  const off=new OffscreenCanvas(tW,tH);
  const oc=off.getContext('2d',{willReadFrequently:true});
  oc.drawImage(ctx.canvas,0,0,W,H,0,0,tW,tH);
  return oc;
}

// ── 오버레이 ──────────────────────────────────────────────────
function _drawOverlay(anchor, W, H, found) {
  if (!_overlayCanvas) return;
  _overlayCanvas.width=W; _overlayCanvas.height=H;
  const oc=_overlayCanvas.getContext('2d');
  oc.clearRect(0,0,W,H);
  if (!anchor) return;

  const { blueCenter:B, redCenter:R, unit } = anchor;
  const color=found?'#00ff88':'#ffdd00';
  oc.strokeStyle=color;oc.lineWidth=3;oc.shadowColor=color;oc.shadowBlur=8;oc.lineCap='round';

  const dotR=Math.max(6,unit*0.10);
  oc.beginPath();oc.arc(B.x,B.y,dotR,0,Math.PI*2);oc.stroke();
  oc.beginPath();oc.arc(R.x,R.y,dotR,0,Math.PI*2);oc.stroke();
  oc.beginPath();oc.moveTo(B.x,B.y);oc.lineTo(R.x,R.y);oc.stroke();

  if (found && anchor.mode==='hondi') {
    const iRoi=_stripRoi(anchor);
    oc.strokeStyle='rgba(255,220,0,0.85)';oc.lineWidth=1.5;
    oc.setLineDash([3,3]);
    oc.strokeRect(iRoi.x,iRoi.y,iRoi.w,iRoi.h);
    oc.setLineDash([]);
  }
}

// ── 진단 패널 ──────────────────────────────────────────────────
function _showDebugDump(data) {
  try {
    let el=document.getElementById('hs-debug-dump');
    if (!el) {
      el=document.createElement('div');el.id='hs-debug-dump';
      el.style.cssText='position:fixed;left:10px;right:10px;bottom:10px;z-index:999999;background:#111;color:#7CFC8A;font:11px/1.45 monospace;padding:12px 14px;border-radius:12px;max-height:42vh;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,.5)';
      document.body.appendChild(el);
    }
    el.innerHTML='';
    const title=document.createElement('div');
    title.textContent='🩺 혼디 스캐너 v3.0 진단 (전체 흑색 오인식)';
    title.style.cssText='color:#fff;font-weight:bold;margin-bottom:8px;';
    const text=JSON.stringify(data,(k,v)=>typeof v==='bigint'?v.toString():v,2);
    const pre=document.createElement('pre');
    pre.style.cssText='margin:0 0 10px;white-space:pre-wrap;word-break:break-all;';
    pre.textContent=text;
    const copyBtn=document.createElement('button');
    copyBtn.textContent='📋 복사하기';
    copyBtn.style.cssText='flex:1;padding:9px;border-radius:9px;border:none;background:#7CFC8A;color:#102010;font-weight:bold;font-size:13px;margin-right:8px;';
    copyBtn.onclick=async()=>{
      try{await navigator.clipboard.writeText(text);copyBtn.textContent='✅ 복사됨!';setTimeout(()=>{copyBtn.textContent='📋 복사하기';},2200);}
      catch(e){copyBtn.textContent='❌ 실패:'+e.message;}
    };
    const closeBtn=document.createElement('button');
    closeBtn.textContent='닫기';
    closeBtn.style.cssText='padding:9px 16px;border-radius:9px;border:none;background:#333;color:#fff;font-size:13px;';
    closeBtn.onclick=()=>el.remove();
    el.appendChild(title);el.appendChild(pre);
    const row=document.createElement('div');row.style.display='flex';
    row.appendChild(copyBtn);row.appendChild(closeBtn);el.appendChild(row);
  } catch(e){console.error('[혼디스캐너] 진단 표시 실패:',e);}
}

// ── 픽셀 유틸 ────────────────────────────────────────────────
function _avgColor(ctx,{x,y,w,h}){
  // 캔버스 경계 클램핑 — 화면 밖 좌표는 getImageData가 (0,0,0,0)을
  // 반환해 bg=(0,0,0)처럼 잘못 측정되는 것을 방지한다.
  const cw=ctx.canvas.width, ch=ctx.canvas.height;
  const ix=Math.max(0,Math.min(cw-1,Math.round(x)));
  const iy=Math.max(0,Math.min(ch-1,Math.round(y)));
  const iw=Math.max(1,Math.min(cw-ix,Math.round(w)));
  const ih=Math.max(1,Math.min(ch-iy,Math.round(h)));
  const d=ctx.getImageData(ix,iy,iw,ih).data;
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
  return n?{r:r/n,g:g/n,b:b/n}:{r:0,g:0,b:0};
}

function _sampleRegion(ctx,{x,y,w,h},step=3){
  const ix=Math.round(x),iy=Math.round(y);
  const iw=Math.max(1,Math.round(w)),ih=Math.max(1,Math.round(h));
  const d=ctx.getImageData(ix,iy,iw,ih).data;
  const s=[];
  for(let i=0;i<d.length;i+=4*step)s.push({r:d[i],g:d[i+1],b:d[i+2]});
  return s;
}

function _playBeep(){
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ac.createOscillator(),gain=ac.createGain();
    osc.connect(gain);gain.connect(ac.destination);
    osc.frequency.value=1320;
    gain.gain.setValueAtTime(0.18,ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    osc.start();osc.stop(ac.currentTime+0.12);
  }catch{}
}

function _status(msg){_onStatus?.(msg);}

// ── L1 프로필 조회 ───────────────────────────────────────────
export async function lookupProfile(shortId, version) {
  const sid=shortId.toString();
  const LOCAL={
    '2577410713':{guid:'hondi-ai',handle:'hondi',name:'혼디',url:'/profiles/5zvxrthQVkz.html'},
  };
  if(LOCAL[sid]) return LOCAL[sid];
  try {
    const base=L1_URL.replace('/api/collections/profiles/records','');
    let res=await fetch(`${base}/api/collections/profiles/records?filter=(hondi_code_id='${sid}')&perPage=1`,{signal:AbortSignal.timeout(5000)});
    if(res.status===400)
      res=await fetch(`${base}/api/collections/profiles/records?filter=(handle='${sid}')&perPage=1`,{signal:AbortSignal.timeout(5000)});
    if(!res.ok) throw new Error(`L1 응답 오류: ${res.status}`);
    const data=await res.json();
    if(!data.items?.length) throw new Error(`등록되지 않은 혼디 코드입니다. (ID:${sid},${version})`);
    const p=data.items[0];
    return{guid:p.ipv6||p.id,handle:p.handle,name:p.name||p.nickname||p.handle,
           url:p.hondi_code_id?`/profiles/${p.hondi_code_id}.html`:`https://hondi.net/profile?id=${p.id}`};
  }catch(e){throw new Error(`프로필 조회 실패: ${e.message}`);}
}
