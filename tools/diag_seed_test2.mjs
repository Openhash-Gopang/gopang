import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROMPTS_ROOT = path.join(REPO_ROOT, 'prompts');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

function readLocal(u) {
  const govTreeIdx = u.indexOf('prompts/gov-tree/');
  const promptsIdx = u.indexOf('prompts/');
  const srcIdx = u.indexOf('src/gopang/gov/');
  let p;
  if (govTreeIdx !== -1) p = path.join(PROMPTS_ROOT, 'gov-tree', u.slice(govTreeIdx + 'prompts/gov-tree/'.length));
  else if (promptsIdx !== -1) p = path.join(PROMPTS_ROOT, u.slice(promptsIdx + 'prompts/'.length));
  else if (srcIdx !== -1) p = path.join(SRC_ROOT, 'gopang/gov', u.slice(srcIdx + 'src/gopang/gov/'.length));
  else return null;
  p = p.split('?')[0];
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

globalThis.window = globalThis;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/gov-tree-instance/lookup')) return { ok: true, json: async () => ({ found: false }) };
  if (u.includes('/sp-author/queue')) return { ok: true, json: async () => ({ status: 'queued' }) };
  const content = readLocal(u);
  if (content === null) return { ok: true, text: async () => '{}', json: async () => ({}) };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

const { assembleGovSystemPrompt } = await import(pathToFileURL(path.join(SRC_ROOT, 'gopang/gov/gov-router.js')));

const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
const all = JSON.parse(raw).읍면동목록;
const targets = all.filter(r => r.청사주소 && !r.청사주소.includes('TBD')).slice(0, 2);

const records = [];
for (const rec of targets) {
  const directCode = `emd:${rec.읍면동명}`;
  const result = await assembleGovSystemPrompt('', null, null, null, directCode);
  const parts = result.systemPrompt.split('\n\n---\n\n');
  records.push({
    tier: 'emd', 도코드: 'busan', 읍면동명: rec.읍면동명,
    institution: `${rec.상위기관명 || ''} ${rec.읍면동명}`.trim(),
    task: '진단용',
    generated_content: parts[parts.length - 1],
  });
}

console.log('보낼 레코드:', records.map(r => r.읍면동명));
console.log('본문 길이:', records.map(r => r.generated_content.length));

globalThis.fetch = fetch; // 원래 네이티브 fetch로 복원(실제 전송용)
const startedAt = Date.now();
const res = await fetch('https://hondi-proxy.tensor-city.workers.dev/gov-tree-instance/seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ records }),
});
const elapsed = Date.now() - startedAt;

console.log('걸린 시간(ms):', elapsed);
console.log('HTTP 상태:', res.status, res.statusText);
console.log('content-length 헤더:', res.headers.get('content-length'));
const text = await res.text();
console.log('원본 응답 길이:', text.length);
console.log('원본 응답:', text);
