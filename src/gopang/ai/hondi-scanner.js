/**
 * hondi-scanner.js — 혼디 시각 코드 스캐너 v4.0
 *
 * ══════════════════════════════════════════════════════════════
 * v4.0 Top-down 방식 (2026-06)
 * ══════════════════════════════════════════════════════════════
 *
 * [핵심 원칙]
 *   색상을 보고 위치를 추정하는 것이 아니라,
 *   위치를 먼저 확정한 뒤 색상만 읽는다.
 *
 * [4개 기준점]
 *   ① 파랑 원(ㅗ 위)   → blueCenter  (원점 O)
 *   ② 빨강 점(ㅗ 아래) → redCenter   (along 방향 + unit 확정)
 *   ③ ㄴ 좌하단 꼭짓점 → 스케일/회전 교차 검증
 *   ④ ㄷ 우상단+우하단  → 격자 오른쪽 경계 및 높이 실측 확정
 *
 * [좌표계]
 *   O   = blueCenter
 *   Un  = (redCenter - O) / unit   (along 방향 단위벡터)
 *   Up  = Un 좌회전 90°             (perp 방향, 오른쪽=음수)
 *   P   = O + along·unit·Un + perp·unit·Up
 *
 * [실측 오프셋] 베이스 이미지 680×542, 2026-06
 *   blue  : along=0.000, perp= 0.000
 *   red   : along=1.000, perp= 0.000
 *   n_sw  : along=2.006, perp= 0.503  (ㄴ 좌하단)
 *   d_ne  : along=-0.323,perp=-2.736  (ㄷ 우상단)
 *   d_se  : along= 0.477,perp=-2.772  (ㄷ 우하단)
 *   strip : top=(-0.708,-3.153), bot=(1.984,-3.177)
 *   bg    : along=-0.710, perp=-3.416
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
const MIN_UNIT_PX = 10;       // 썸네일 기준 최소 unit
const UCB_ASPECT_MAX = 0.55;

// ── 실측 오프셋 상수 (unit 단위) ─────────────────────────────
const AO = {
  n_sw:      [ 2.006,  0.503],   // ㄴ 좌하단 꼭짓점 (검증용)
  d_ne:      [-0.323, -2.736],   // ㄷ 우상단 꼭짓점 (격자 경계)
  d_se:      [ 0.477, -2.772],   // ㄷ 우하단 꼭짓점 (격자 경계)
  strip_top: [-0.708, -3.153],   // 색상 막대 상단
  strip_bot: [ 1.984, -3.177],   // 색상 막대 하단
  bg:        [-0.710, -3.416],   // 배경 샘플
  d_center:  [ 0.062, -2.114],   // ㄷ 중심 (버전 판별)
};

const SAMPLE_W  = 0.21;
const SAMPLE_H  = 0.16;
const STRIP_W_U = 0.342;

// 검정 꼭짓점 판정: 평균 밝기 < 이 값
const BLACK_THRESHOLD = 100;
// 꼭짓점 샘플 영역 크기 (unit 단위)
const CORNER_SAMPLE = 0.12;

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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = _stream;
    await video.play();
    _status('혼디 코드를 화면에 맞춰주세요.');
    _scheduleFrame(video, canvas);
  } catch(e) {
    const msg =
      e.name==='NotAllowedError'     ? '카메라 권한이 거부됐습니다. 설정에서 허용해 주세요.' :
      e.name==='NotFoundError'       ? '카메라를 찾을 수 없습니다.' :
      e.name==='NotReadableError'    ? '카메라가 다른 앱에서 사용 중입니다.' :
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0);
  const result = _analyzeFrame(ctx, W, H);
  _drawOverlay(result, W, H);

  if (!result) { _lockCount = 0; _lastId = null; return; }

  const idStr = result.shortId.toString();
  if (idStr === _lastId) _lockCount++; else { _lockCount = 1; _lastId = idStr; }
  _status(`인식 중... ${Math.round(_lockCount/LOCK_FRAMES*100)}%`);

  if (_lockCount >= LOCK_FRAMES) {
    _locked = true;
    stopScanner();
    if (navigator.vibrate) navigator.vibrate([60,30,60]);
    _playBeep();
    _onResult?.(result.shortId, result.version);
  }
}

// ── 프레임 분석 (Top-down) ────────────────────────────────────
function _analyzeFrame(ctx, W, H) {
  // 1단계: 썸네일에서 파랑+빨강 앵커 탐지
  const tW = Math.round(W * THUMB_SCALE);
  const tH = Math.round(H * THUMB_SCALE);
  const tCtx = _makeThumb(ctx, W, H, tW, tH);
  const tAnchor = _detectColorAnchors(tCtx, tW, tH);
  if (!tAnchor) return null;

  // 2단계: 원본 좌표로 변환
  const anchor = _scaleAnchor(tAnchor, 1 / THUMB_SCALE);

  // 3단계: ㄴ, ㄷ 꼭짓점으로 위치 검증 및 격자 경계 실측 확정
  const verified = _verifyAndRefine(ctx, anchor);
  if (!verified) return null;

  // 4단계: UCB vs 혼디 모드
  if (anchor.mode === 'ucb') return _decodeUCB(ctx, anchor);
  return _decodeHondi(ctx, verified);
}

// ── 1단계: 파랑+빨강 앵커 탐지 ───────────────────────────────
function _detectColorAnchors(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;
  const blueMask = new Uint8Array(W * H);
  const redMask  = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y*W+x)*4;
      const r=data[i], g=data[i+1], b=data[i+2];
      const px = y*W+x;
      if (b>100 && r<110 && g<110 && b-Math.max(r,g)>40) blueMask[px]=1;
      if (r>100 && g<50  && b<110 && r-Math.max(g,b)>40) redMask[px]=1;
    }
  }
  if (_maskCount(blueMask)<4 || _maskCount(redMask)<4) return null;

  const blueBox = _largestComponentBbox(blueMask, W, H);
  const redBox  = _largestComponentBbox(redMask,  W, H);
  if (!blueBox || !redBox) return null;

  const blueCenter = _componentCenter(blueMask, blueBox, W);
  const redCenter  = _componentCenter(redMask,  redBox,  W);
  const dx = redCenter.x-blueCenter.x, dy = redCenter.y-blueCenter.y;
  const unit = Math.sqrt(dx*dx+dy*dy);
  if (unit < MIN_UNIT_PX) return null;

  const x1=Math.min(blueBox.x1,redBox.x1), y1=Math.min(blueBox.y1,redBox.y1);
  const gW=Math.max(blueBox.x2,redBox.x2)-x1, gH=Math.max(blueBox.y2,redBox.y2)-y1;
  const mode = (gH>0 && gW/gH < UCB_ASPECT_MAX) ? 'ucb' : 'hondi';

  return { mode, blueCenter, redCenter, unit, blueBox, redBox };
}

// ── 3단계: ㄴ·ㄷ 꼭짓점으로 검증 + 격자 경계 실측 ───────────
function _verifyAndRefine(ctx, anchor) {
  // ㄴ 좌하단 꼭짓점 → 검정 확인
  const n_sw = _anchorToXY(anchor, AO.n_sw[0], AO.n_sw[1]);
  const n_bright = _sampleBrightness(ctx, n_sw.x, n_sw.y, CORNER_SAMPLE * anchor.unit);
  if (n_bright > BLACK_THRESHOLD) return null;  // ㄴ 꼭짓점이 검정이 아님

  // ㄷ 우상단, 우하단 꼭짓점 → 검정 확인
  const d_ne = _anchorToXY(anchor, AO.d_ne[0], AO.d_ne[1]);
  const d_se = _anchorToXY(anchor, AO.d_se[0], AO.d_se[1]);
  const dne_bright = _sampleBrightness(ctx, d_ne.x, d_ne.y, CORNER_SAMPLE * anchor.unit);
  const dse_bright = _sampleBrightness(ctx, d_se.x, d_se.y, CORNER_SAMPLE * anchor.unit);
  if (dne_bright > BLACK_THRESHOLD || dse_bright > BLACK_THRESHOLD) return null;

  // ㄷ 우상단·우하단으로 색상 막대 경계 실측 보정
  // ㄷ에서 막대까지 거리는 약 0.234 unit (실측: 48px/190.2)
  const STRIP_OFFSET_PERP = -0.234;  // ㄷ 우측에서 막대까지 (perp 방향)

  // ㄷ 우상단·하단의 perp 좌표 평균으로 막대 X 결정
  const strip_perp = (AO.d_ne[1] + AO.d_se[1]) / 2 + STRIP_OFFSET_PERP;

  // 막대 Y: d_ne의 along(상단), d_se의 along(하단) 기준 보정
  const strip_top_along = AO.d_ne[0] + 0.010;
  const strip_bot_along = AO.d_se[0] + 1.507;  // ㄷ 하단에서 막대 하단까지

  return {
    ...anchor,
    // 실측 보정된 막대 좌표
    refinedStrip: {
      top_along: strip_top_along,
      bot_along: strip_bot_along,
      perp: strip_perp,
    },
    // 검증된 꼭짓점 좌표 (오버레이용)
    corners: { n_sw, d_ne, d_se },
  };
}

// ── 혼디 코드 디코딩 ──────────────────────────────────────────
function _decodeHondi(ctx, anchor) {
  // 캘리브레이션: 파랑/빨강 클러스터 직접 평균
  const blueAvg = _clusterAvg(ctx, anchor.blueBox, true);
  const redAvg  = _clusterAvg(ctx, anchor.redBox,  false);

  const n_roi = _anchorRect(anchor, AO.n_sw[0]-0.3, AO.n_sw[1], SAMPLE_W, SAMPLE_H);
  const bg_roi= _anchorRect(anchor, AO.bg[0],       AO.bg[1],   SAMPLE_W, SAMPLE_H);

  const calib = {
    hih: blueAvg,
    ho:  redAvg,
    n:   _avgColor(ctx, n_roi),
    bg:  _avgColor(ctx, bg_roi),
  };
  const matrix = buildCalibMatrix(calib);

  // 버전 판별 (ㄷ 중심)
  const dRect  = _anchorRect(anchor, AO.d_center[0], AO.d_center[1], SAMPLE_W*1.5, SAMPLE_H*2);
  const version = detectVersion(_sampleRegion(ctx, dRect));

  // 색상 막대 ROI — 실측 보정값 사용
  const rs = anchor.refinedStrip;
  const topPt = _anchorToXY(anchor, rs.top_along, rs.perp);
  const botPt = _anchorToXY(anchor, rs.bot_along, rs.perp);
  const stripH = Math.abs(botPt.y - topPt.y);
  const stripY = Math.min(topPt.y, botPt.y);
  const stripCX = (topPt.x + botPt.x) / 2;
  const stripW  = STRIP_W_U * anchor.unit;
  const iRoi = { x: stripCX - stripW/2, y: stripY, w: stripW, h: stripH };

  if (!iRoi._valid && (iRoi.y < -iRoi.h*0.5 || iRoi.x < -iRoi.w*0.5)) return null;

  const indices = _extractIndices(ctx, iRoi, version, matrix);
  const shortId = indicesToId(indices);

  if (indices.every(i => i===8)) {
    const dbg = { calib, matrix, iRoi, anchorUnit: anchor.unit, ua: navigator.userAgent };
    console.warn('[스캐너 v4] 전체 흑색:', dbg);
    _showDebugDump(dbg);
  }

  return { shortId, version, anchor };
}

// ── UCB 디코딩 ───────────────────────────────────────────────
function _decodeUCB(ctx, anchor) {
  const { blueCenter:B, redCenter:R, unit } = anchor;
  const topY=Math.min(B.y,R.y), botY=Math.max(B.y,R.y);
  const barH=botY-topY, dotSz=Math.max(6,unit*0.8);
  const barCX=(B.x+R.x)/2, barW=Math.max(6,unit*0.6);
  const hihRoi={x:barCX-dotSz/2,y:topY-dotSz/2,w:dotSz,h:dotSz};
  const hoRoi ={x:barCX-dotSz/2,y:botY-dotSz/2,w:dotSz,h:dotSz};
  const bgRoi ={x:Math.max(0,barCX-barW-12),y:topY,w:10,h:10};
  const iRoi  ={x:barCX-barW/2,y:topY,w:barW,h:barH};
  const calib={hih:_avgColor(ctx,hihRoi),ho:_avgColor(ctx,hoRoi),
               n:_avgColor(ctx,bgRoi),bg:_avgColor(ctx,bgRoi)};
  const matrix=buildCalibMatrix(calib);
  const version=detectVersion(_sampleRegion(ctx,{x:barCX-barW/2,y:topY+barH*0.3,w:barW,h:barH*0.4}));
  const indices=_extractIndices(ctx,iRoi,version,matrix);
  return { shortId: indicesToId(indices), version, anchor };
}

// ── 좌표 헬퍼 ────────────────────────────────────────────────
function _anchorToXY(anchor, along, perp) {
  const {blueCenter:O, redCenter:E, unit} = anchor;
  const Ux=(E.x-O.x)/unit, Uy=(E.y-O.y)/unit;
  const Px=-Uy, Py=Ux;
  return { x: O.x+along*unit*Ux+perp*unit*Px, y: O.y+along*unit*Uy+perp*unit*Py };
}

function _anchorRect(anchor, along, perp, wU, hU) {
  const c=_anchorToXY(anchor,along,perp);
  return { x:c.x-wU*anchor.unit/2, y:c.y-hU*anchor.unit/2, w:wU*anchor.unit, h:hU*anchor.unit };
}

function _scaleAnchor(a, s) {
  const sp=p=>({x:p.x*s,y:p.y*s});
  const sb=b=>({x1:b.x1*s,y1:b.y1*s,x2:b.x2*s,y2:b.y2*s,size:b.size});
  return { mode:a.mode, unit:a.unit*s,
           blueCenter:sp(a.blueCenter), redCenter:sp(a.redCenter),
           blueBox:sb(a.blueBox), redBox:sb(a.redBox) };
}

// ── 검정 밝기 샘플 ───────────────────────────────────────────
function _sampleBrightness(ctx, cx, cy, radius) {
  const r = Math.max(4, Math.round(radius));
  const cw=ctx.canvas.width, ch=ctx.canvas.height;
  const x=Math.max(0,Math.round(cx-r)), y=Math.max(0,Math.round(cy-r));
  const w=Math.min(r*2,cw-x), h=Math.min(r*2,ch-y);
  if (w<=0||h<=0) return 255;
  const d=ctx.getImageData(x,y,w,h).data;
  let sum=0, n=0;
  for(let i=0;i<d.length;i+=4){ sum+=d[i]+d[i+1]+d[i+2]; n+=3; }
  return n ? sum/n : 255;
}

// ── 연결요소 BFS ──────────────────────────────────────────────
function _largestComponentBbox(mask, W, H) {
  const vis=new Uint8Array(W*H);
  const qx=new Int32Array(W*H), qy=new Int32Array(W*H);
  let best=null, bestSize=0;
  for(let sy=0;sy<H;sy++) for(let sx=0;sx<W;sx++) {
    const si=sy*W+sx;
    if(!mask[si]||vis[si]) continue;
    let head=0,tail=0;
    qx[tail]=sx;qy[tail]=sy;tail++;vis[si]=1;
    let x1=sx,y1=sy,x2=sx,y2=sy,size=0;
    while(head<tail){
      const cx=qx[head],cy=qy[head];head++;size++;
      if(cx<x1)x1=cx;if(cx>x2)x2=cx;if(cy<y1)y1=cy;if(cy>y2)y2=cy;
      for(const[nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]){
        if(nx<0||nx>=W||ny<0||ny>=H) continue;
        const ni=ny*W+nx;
        if(mask[ni]&&!vis[ni]){vis[ni]=1;qx[tail]=nx;qy[tail]=ny;tail++;}
      }
    }
    if(size>bestSize){bestSize=size;best={x1,y1,x2,y2,size};}
  }
  return best;
}

function _componentCenter(mask, bbox, W) {
  let sx=0,sy=0,n=0;
  for(let y=bbox.y1;y<=bbox.y2;y++) for(let x=bbox.x1;x<=bbox.x2;x++)
    if(mask[y*W+x]){sx+=x;sy+=y;n++;}
  return n?{x:sx/n,y:sy/n}:{x:(bbox.x1+bbox.x2)/2,y:(bbox.y1+bbox.y2)/2};
}

function _maskCount(mask){let n=0;for(let i=0;i<mask.length;i++)if(mask[i])n++;return n;}

function _clusterAvg(ctx, box, isBlue) {
  const x=Math.round(box.x1),y=Math.round(box.y1);
  const w=Math.max(1,Math.round(box.x2-box.x1)),h=Math.max(1,Math.round(box.y2-box.y1));
  const d=ctx.getImageData(x,y,w,h).data;
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){
    const pr=d[i],pg=d[i+1],pb=d[i+2];
    if(isBlue){if(pb>100&&pr<110&&pg<110&&pb-Math.max(pr,pg)>40){r+=pr;g+=pg;b+=pb;n++;}}
    else       {if(pr>100&&pg<50 &&pb<110&&pr-Math.max(pg,pb)>40){r+=pr;g+=pg;b+=pb;n++;}}
  }
  return n?{r:r/n,g:g/n,b:b/n}:(isBlue?{r:0,g:0,b:220}:{r:220,g:0,b:0});
}

// ── ㅣ → 인덱스 ──────────────────────────────────────────────
function _extractIndices(ctx, iRoi, version, matrix) {
  const ROWS=10, cellH=iRoi.h/ROWS;
  const indices=[];
  if(version==='v1'){
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

// ── 썸네일 ───────────────────────────────────────────────────
function _makeThumb(ctx, W, H, tW, tH) {
  const off=new OffscreenCanvas(tW,tH);
  const oc=off.getContext('2d',{willReadFrequently:true});
  oc.drawImage(ctx.canvas,0,0,W,H,0,0,tW,tH);
  return oc;
}

// ── 오버레이 ──────────────────────────────────────────────────
function _drawOverlay(result, W, H) {
  if(!_overlayCanvas) return;
  _overlayCanvas.width=W; _overlayCanvas.height=H;
  const oc=_overlayCanvas.getContext('2d');
  oc.clearRect(0,0,W,H);
  if(!result) return;

  const anchor = result.anchor;
  const {blueCenter:B, redCenter:R, unit} = anchor;
  const found = !!result;
  const color = found?'#00ff88':'#ffdd00';
  oc.strokeStyle=color; oc.lineWidth=3; oc.shadowColor=color; oc.shadowBlur=8;

  // 파랑/빨강 원
  const dotR=Math.max(6,unit*0.10);
  oc.beginPath();oc.arc(B.x,B.y,dotR,0,Math.PI*2);oc.stroke();
  oc.beginPath();oc.arc(R.x,R.y,dotR,0,Math.PI*2);oc.stroke();
  oc.beginPath();oc.moveTo(B.x,B.y);oc.lineTo(R.x,R.y);oc.stroke();

  // 검증된 꼭짓점
  if(anchor.corners) {
    oc.strokeStyle='rgba(255,255,100,0.9)'; oc.lineWidth=2;
    for(const pt of Object.values(anchor.corners)){
      oc.beginPath();oc.arc(pt.x,pt.y,6,0,Math.PI*2);oc.stroke();
    }
  }

  // 색상 막대 영역
  if(anchor.refinedStrip && anchor.mode==='hondi'){
    const rs=anchor.refinedStrip;
    const topPt=_anchorToXY(anchor,rs.top_along,rs.perp);
    const botPt=_anchorToXY(anchor,rs.bot_along,rs.perp);
    const h=Math.abs(botPt.y-topPt.y);
    const cx=(topPt.x+botPt.x)/2;
    const w=STRIP_W_U*unit;
    oc.strokeStyle='rgba(255,220,0,0.9)'; oc.lineWidth=1.5;
    oc.setLineDash([3,3]);
    oc.strokeRect(cx-w/2,Math.min(topPt.y,botPt.y),w,h);
    oc.setLineDash([]);
  }
}

// ── 진단 패널 ────────────────────────────────────────────────
function _showDebugDump(data) {
  try {
    let el=document.getElementById('hs-debug-dump');
    if(!el){
      el=document.createElement('div');el.id='hs-debug-dump';
      el.style.cssText='position:fixed;left:10px;right:10px;bottom:10px;z-index:999999;background:#111;color:#7CFC8A;font:11px/1.45 monospace;padding:12px;border-radius:12px;max-height:42vh;overflow:auto';
      document.body.appendChild(el);
    }
    el.innerHTML='';
    const title=document.createElement('div');
    title.textContent='🩺 혼디 스캐너 v4.0 진단';
    title.style.cssText='color:#fff;font-weight:bold;margin-bottom:8px';
    const text=JSON.stringify(data,(k,v)=>typeof v==='bigint'?v.toString():v,2);
    const pre=document.createElement('pre');
    pre.style.cssText='margin:0 0 10px;white-space:pre-wrap;word-break:break-all';
    pre.textContent=text;
    const row=document.createElement('div');row.style.display='flex';
    const copyBtn=document.createElement('button');
    copyBtn.textContent='📋 복사';
    copyBtn.style.cssText='flex:1;padding:8px;border-radius:8px;border:none;background:#7CFC8A;color:#102010;font-weight:bold;margin-right:8px';
    copyBtn.onclick=async()=>{
      try{await navigator.clipboard.writeText(text);copyBtn.textContent='✅';}
      catch(e){copyBtn.textContent='❌';}
    };
    const closeBtn=document.createElement('button');
    closeBtn.textContent='닫기';
    closeBtn.style.cssText='padding:8px 16px;border-radius:8px;border:none;background:#333;color:#fff';
    closeBtn.onclick=()=>el.remove();
    row.appendChild(copyBtn);row.appendChild(closeBtn);
    el.appendChild(title);el.appendChild(pre);el.appendChild(row);
  }catch(e){console.error(e);}
}

// ── 픽셀 유틸 ────────────────────────────────────────────────
function _avgColor(ctx,{x,y,w,h}){
  const cw=ctx.canvas.width,ch=ctx.canvas.height;
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
  const cw=ctx.canvas.width,ch=ctx.canvas.height;
  const ix=Math.max(0,Math.min(cw-1,Math.round(x)));
  const iy=Math.max(0,Math.min(ch-1,Math.round(y)));
  const iw=Math.max(1,Math.min(cw-ix,Math.round(w)));
  const ih=Math.max(1,Math.min(ch-iy,Math.round(h)));
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
  const LOCAL={'2577410713':{guid:'hondi-ai',handle:'hondi',name:'혼디',url:'/profiles/5zvxrthQVkz.html'}};
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
