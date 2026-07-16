// 1단계 코드 매칭 예시 (LLM 호출 없이 즉시 처리)
// ksic-flat.csv를 로드해 code<->name 매핑 + 역방향 키워드 인덱스 구성
// 기존 industry-router.js의 EMG fast-path와 동일한 패턴

const fs = require('fs');
const path = require('path');

function loadKsicFlat(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').slice(1);
  const byCode = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    // 콤마가 이름 안에 포함될 수 있어 마지막 필드부터 역파싱
    const parts = line.split(',');
    const parent = parts.pop().trim();
    const level = parts.pop().trim();
    const code = parts.shift().trim();
    const name = parts.join(',').replace(/^"|"$/g, '');
    byCode.set(code, { code, name, level: Number(level), parent });
  }
  return byCode;
}

function buildKeywordIndex(byCode) {
  // name에 포함된 키워드 -> [code,...] 역인덱스 (레벨 5, 즉 세세분류만)
  const index = new Map();
  for (const [code, node] of byCode) {
    if (node.level !== 5) continue;
    for (const kw of node.name.split(/[,\s]+/).filter(Boolean)) {
      if (!index.has(kw)) index.set(kw, []);
      index.get(kw).push(code);
    }
  }
  return index;
}

// 사용 예:
// const byCode = loadKsicFlat('./out/ksic-flat.csv');
// const idx = buildKeywordIndex(byCode);
// idx.get('카페')  -> 직접 매치가 없으면 2단계(임베딩/paths.jsonl)로 넘김

module.exports = { loadKsicFlat, buildKeywordIndex };
