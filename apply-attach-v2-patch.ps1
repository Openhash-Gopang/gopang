# apply-attach-v2-patch.ps1
# ⚠ 이 스크립트는 "원본" webapp.html(지난 턴의 sha256-only 패치를
#   아직 적용 안 한 상태) 기준으로 짜여 있습니다.
#   이미 apply-sha256-patch.ps1을 실행했다면, 먼저 되돌리세요:
#     git checkout -- webapp.html
#   (커밋까지 했다면 git revert 또는 git reset --hard HEAD~1로 되돌린 뒤 실행)
#
# 사용법: gopang 리포 루트에서
#   powershell -ExecutionPolicy Bypass -File .\apply-attach-v2-patch.ps1

$ErrorActionPreference = 'Stop'
$path = ".\webapp.html"
if (-not (Test-Path $path)) { throw "webapp.html을 찾을 수 없습니다 — 리포 루트에서 실행하세요." }

$enc = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText((Resolve-Path $path), $enc)

$backupPath = ".\webapp.html.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $path $backupPath
Write-Host "백업 생성: $backupPath"

# ── ① HTML — multiple 속성 추가 ──────────────────────────────────
$oldHtml = '<input type="file" id="ai-panel-file-input" style="display:none" accept="image/*,.pdf,.txt,.docx" onchange="handleFileSelect(event)">'
$newHtml = '<input type="file" id="ai-panel-file-input" style="display:none" accept="image/*,.pdf,.txt,.docx" multiple onchange="handleFileSelect(event)">'
# 참고: 1403줄 실제 input에는 onchange가 없는 버전(2725줄에서 별도
# addEventListener로 바인딩)일 수 있어 아래 대체안도 함께 시도한다.
$oldHtmlAlt = '<input type="file" id="ai-panel-file-input" style="display:none" accept="image/*,.pdf,.txt,.docx">'
$newHtmlAlt = '<input type="file" id="ai-panel-file-input" style="display:none" accept="image/*,.pdf,.txt,.docx" multiple>'

# ── ② _readAttachedFile + 이벤트리스너 5줄 → 헬퍼 전체 세트로 교체 ──
$oldJs1 = @'
  function _readAttachedFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      _aiPanelAttachedFile = { name: file.name, dataUrl: reader.result, isImage: file.type.startsWith('image/') };
      attachNameEl.textContent = (_aiPanelAttachedFile.isImage ? '📷 ' : '📎 ') + file.name;
      attachPreview.style.display = 'flex';
      _updatePanelSendState();
    };
    reader.readAsDataURL(file);
  }
  attachBtn?.addEventListener('click', () => fileInput?.click());
  cameraBtn?.addEventListener('click', () => cameraInput?.click());
  fileInput?.addEventListener('change', e => _readAttachedFile(e.target.files?.[0]));
  cameraInput?.addEventListener('change', e => _readAttachedFile(e.target.files?.[0]));
  attachRemoveBtn?.addEventListener('click', _clearAttachPreview);
'@

$newJs1 = @'
  let _pdfjsLoaded = null;
  function _ensurePdfJs() {
    if (_pdfjsLoaded) return _pdfjsLoaded;
    _pdfjsLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
        resolve();
      };
      s.onerror = () => reject(new Error('pdf.js 로드 실패'));
      document.head.appendChild(s);
    });
    return _pdfjsLoaded;
  }
  let _mammothLoaded = null;
  function _ensureMammoth() {
    if (_mammothLoaded) return _mammothLoaded;
    _mammothLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('mammoth.js 로드 실패'));
      document.head.appendChild(s);
    });
    return _mammothLoaded;
  }
  async function _extractFileText(file) {
    const MAX_CHARS = 20000;
    try {
      if (file.type === 'text/plain') return (await file.text()).slice(0, MAX_CHARS);
      if (file.type === 'application/pdf') {
        await _ensurePdfJs();
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages && text.length < MAX_CHARS; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(it => it.str).join(' ') + '\n';
        }
        return text.slice(0, MAX_CHARS);
      }
      if (file.name.toLowerCase().endsWith('.docx')) {
        await _ensureMammoth();
        const buf = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
        return (result.value || '').slice(0, MAX_CHARS);
      }
    } catch (e) {
      console.warn('[Attach] 본문 추출 실패:', file.name, e.message);
      return null;
    }
    return null;
  }
  let _aiPanelAttachedFiles = [];
  function _renderAttachPreview() {
    if (!_aiPanelAttachedFiles.length) { attachPreview.style.display = 'none'; return; }
    const names = _aiPanelAttachedFiles.map(f => (f.isImage ? '📷 ' : '📎 ') + f.name).join(', ');
    attachNameEl.textContent = _aiPanelAttachedFiles.length > 1
      ? `${_aiPanelAttachedFiles.length}개 파일: ${names}` : names;
    attachPreview.style.display = 'flex';
  }
  async function _addAttachedFile(file) {
    if (!file) return;
    const entry = { name: file.name, dataUrl: null, isImage: file.type.startsWith('image/'),
      mimeType: file.type, sha256: null, extractedText: null, _hashPromise: null, _extractPromise: null };
    const reader = new FileReader();
    const dataUrlPromise = new Promise((resolve) => { reader.onload = () => { entry.dataUrl = reader.result; resolve(); }; });
    reader.readAsDataURL(file);
    await dataUrlPromise;
    entry._hashPromise = file.arrayBuffer()
      .then(buf => crypto.subtle.digest('SHA-256', buf))
      .then(hashBuf => Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join(''))
      .then(hex => { entry.sha256 = hex; return hex; })
      .catch(e => { console.warn('[Attach] SHA-256 계산 실패:', e.message); return null; });
    entry._extractPromise = entry.isImage ? Promise.resolve(null)
      : _extractFileText(file).then(text => { entry.extractedText = text; return text; });
    _aiPanelAttachedFiles.push(entry);
    _renderAttachPreview();
    _updatePanelSendState();
  }
  attachBtn?.addEventListener('click', () => fileInput?.click());
  cameraBtn?.addEventListener('click', () => cameraInput?.click());
  fileInput?.addEventListener('change', e => { Array.from(e.target.files || []).forEach(f => _addAttachedFile(f)); });
  cameraInput?.addEventListener('change', e => { Array.from(e.target.files || []).forEach(f => _addAttachedFile(f)); });
  attachRemoveBtn?.addEventListener('click', _clearAttachPreview);
'@

# ── ③ _clearAttachPreview 몸체 — 전역변수명 배열로 교체 ─────────────
$oldJs2 = @'
  function _clearAttachPreview() {
    _aiPanelAttachedFile = null;
    attachPreview.style.display = 'none';
    if (fileInput)   fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
    _updatePanelSendState();
  }
'@
$newJs2 = @'
  function _clearAttachPreview() {
    _aiPanelAttachedFiles = [];
    attachPreview.style.display = 'none';
    if (fileInput)   fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
    _updatePanelSendState();
  }
'@

# ── ④ _sendToAI — 배열 전체 전달 ────────────────────────────────
$oldJs3 = @'
  async function _sendToAI() {
    const text = input.value.trim();
    const attached = _aiPanelAttachedFile;
    if (!text && !attached) return;
    input.value = ''; input.style.height = 'auto';
    _setPanelGenerating(true);
    _appendPanelMsg('user', text || (attached.isImage ? '(사진 첨부)' : `(파일 첨부: ${attached.name})`));
    _clearAttachPreview();

    const aiBubble = _appendPanelMsg('ai', '…');
    aiBubble.classList.add('streaming');
    try {
      await _callPanelAI(text, aiBubble, attached);
    } catch(e) {
      aiBubble.textContent = 'AI 오류: ' + e.message;
    }
'@
$newJs3 = @'
  async function _sendToAI() {
    const text = input.value.trim();
    const attachedList = _aiPanelAttachedFiles.slice();
    if (!text && !attachedList.length) return;
    input.value = ''; input.style.height = 'auto';
    _setPanelGenerating(true);
    const attachLabel = attachedList.length
      ? (attachedList.length === 1
          ? (attachedList[0].isImage ? '(사진 첨부)' : `(파일 첨부: ${attachedList[0].name})`)
          : `(파일 ${attachedList.length}개 첨부)`)
      : '';
    _appendPanelMsg('user', text || attachLabel);
    _clearAttachPreview();

    const aiBubble = _appendPanelMsg('ai', '…');
    aiBubble.classList.add('streaming');
    try {
      await _callPanelAI(text, aiBubble, attachedList);
    } catch(e) {
      aiBubble.textContent = 'AI 오류: ' + e.message;
    }
'@

# ── ⑤ userContent 조립부 — 다중파일 + 본문추출 반영 ─────────────────
$oldJs4 = @'
    // 첨부파일 반영 — 사진은 멀티모달 image_url 블록, 그 외 파일은 파일명만 텍스트로 첨부
    let userContent = userText;
    if (attached?.isImage) {
      userContent = [
        { type: 'text', text: userText || '이 사진을 봐주세요.' },
        { type: 'image_url', image_url: { url: attached.dataUrl } },
      ];
    } else if (attached) {
      userContent = (userText ? userText + '\n' : '') + `[첨부파일: ${attached.name} — 본문 추출 미지원]`;
    }
'@
$newJs4 = @'
    // 첨부파일 반영 — 이미지는 image_url 블록 + sha256, 그 외(txt/pdf/docx)는
    // pdf.js/mammoth.js로 추출한 본문 전체를 텍스트로 첨부 (2026-07-12 v2)
    let userContent = userText;
    const files = Array.isArray(attached) ? attached : (attached ? [attached] : []);
    if (files.length) {
      await Promise.all(files.map(f => Promise.all([
        f._hashPromise    ? f._hashPromise.catch(() => null)    : null,
        f._extractPromise ? f._extractPromise.catch(() => null) : null,
      ])));
      const contentBlocks = [];
      const textParts = [];
      if (userText) textParts.push(userText);
      for (const f of files) {
        if (f.isImage) {
          contentBlocks.push({ type: 'image_url', image_url: { url: f.dataUrl } });
          textParts.push(f.sha256
            ? `[첨부 이미지: "${f.name}", sha256=${f.sha256} — 정부서비스 서류 접수가 필요하면 GOV_TASK_SUBMIT_REQUEST의 documents 항목에 이 sha256을 그대로 사용하세요. 어떤 서류인지는 사진 내용과 대화 맥락으로 판단하세요.]`
            : `[첨부 이미지: "${f.name}" — sha256 계산 실패, GOV_TASK_SUBMIT_REQUEST를 만들 수 없습니다.]`);
        } else if (f.extractedText) {
          textParts.push(`[첨부파일 "${f.name}" 본문 추출 결과${f.sha256 ? ` | sha256=${f.sha256}` : ''}]\n${f.extractedText}\n[본문 추출 끝 — 위 내용을 근거로 이 파일이 어떤 서류인지 직접 판단하세요${f.sha256 ? `. GOV_TASK_SUBMIT_REQUEST의 documents 항목에는 이 sha256을 사용하세요.]` : ' (sha256 계산 실패로 GOV_TASK_SUBMIT_REQUEST에는 쓸 수 없습니다).]'}`);
        } else {
          textParts.push(`[첨부파일: "${f.name}"${f.sha256 ? ` | sha256=${f.sha256}` : ''} — 본문 추출 실패 또는 미지원 형식. 파일명과 대화 맥락으로만 판단해야 합니다.]`);
        }
      }
      const combinedText = textParts.join('\n');
      userContent = contentBlocks.length ? [{ type: 'text', text: combinedText }, ...contentBlocks] : combinedText;
    }
'@

$replacements = @(
  @{ Name = '① HTML multiple 속성(onchange 있는 버전)'; Old = $oldHtml;  New = $newHtml;  Optional = $true },
  @{ Name = '① HTML multiple 속성(onchange 없는 버전)'; Old = $oldHtmlAlt; New = $newHtmlAlt; Optional = $true },
  @{ Name = '② _readAttachedFile → 헬퍼 세트';           Old = $oldJs1;   New = $newJs1 },
  @{ Name = '③ _clearAttachPreview';                     Old = $oldJs2;   New = $newJs2 },
  @{ Name = '④ _sendToAI';                                Old = $oldJs3;   New = $newJs3 },
  @{ Name = '⑤ userContent 조립부';                       Old = $oldJs4;   New = $newJs4 }
)

$applied = 0
foreach ($r in $replacements) {
  if ($content.Contains($r.Old)) {
    $content = $content.Replace($r.Old, $r.New)
    Write-Host "✅ $($r.Name) 치환 완료"
    $applied++
  } elseif ($r.Optional) {
    Write-Host "ℹ️  $($r.Name) — 이 버전은 해당 안 됨(정상, ①은 둘 중 하나만 맞으면 됨)"
  } else {
    Write-Warning "⚠️ $($r.Name) — 원본과 일치하는 블록을 못 찾았습니다. 수동 확인 필요."
  }
}

if ($applied -gt 0) {
  [System.IO.File]::WriteAllText((Resolve-Path $path), $content, $enc)
  Write-Host "`nwebapp.html 저장 완료 ($applied개 블록 치환됨)"
} else {
  Write-Host "`n치환된 블록이 없어 파일을 다시 쓰지 않았습니다."
}
Write-Host "`n변경 diff 확인: git diff webapp.html"
