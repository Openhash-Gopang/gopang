#!/usr/bin/env node
/**
 * scripts/build-manifest.js
 *
 * manifest.json의 각 값(파일명)에서 "_v{버전}.{ext}" 또는 "-v{버전}.{ext}" 패턴을
 * 인식해, 같은 접두사(prefix)를 가진 prompts/ 폴더 내 파일들 중 버전이 가장
 * 높은 파일로 자동 교체한다.
 *
 *   - 버전 비교는 문자열이 아니라 "."와 "_"로 분리한 숫자 배열로 한다
 *     (v2.10 > v2.9 를 올바르게 판단하기 위해 — 문자열 비교로는 "2.10" < "2.9").
 *   - 키 이름 자체는 바꾸지 않는다. 새 SP를 처음 등록할 때만 manifest.json에
 *     키 한 줄을 수동으로 추가하면 되고, 그 다음부터는 버전 갱신이 전부 자동이다.
 *   - 어떤 키에 대해 매칭되는 파일이 하나도 없으면(접두사가 실제로 바뀐 경우 등)
 *     해당 키는 건드리지 않고 경고만 출력한다 — 조용히 깨지는 것보다 낫다.
 *
 * 사용법:
 *   node scripts/build-manifest.js            # prompts/manifest.json 갱신
 *   node scripts/build-manifest.js --check    # 변경사항만 출력, 파일은 안 건드림 (CI용)
 */

const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.join(__dirname, "..", "prompts");
const MANIFEST_PATH = path.join(PROMPTS_DIR, "manifest.json");
const CHECK_ONLY = process.argv.includes("--check");

// "...prefix_v1.2.3.txt" / "...prefix-v1_2.txt" 등에서 prefix / version / ext 분리
const VERSION_RE = /^(?<prefix>.*?)[-_]v(?<version>[\d._]+)\.(?<ext>txt|md)$/i;

function parseVersion(verStr) {
  // "2_4" 든 "2.4" 든 전부 점/언더스코어로 나눠 숫자 배열로
  return verStr.split(/[._]/).map((n) => parseInt(n, 10) || 0);
}

function compareVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// dir 기준 상대경로로 모든 파일을 재귀적으로 나열 (personal-assistant/ 같은 하위폴더 포함)
function listFilesRecursive(dir, base = "") {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results = results.concat(listFilesRecursive(path.join(dir, entry.name), relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

function buildManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const allFiles = listFilesRecursive(PROMPTS_DIR);
  const changes = [];
  const warnings = [];

  for (const key of Object.keys(manifest)) {
    const currentValue = manifest[key];
    const m = currentValue.match(VERSION_RE);
    if (!m) {
      // 버전 패턴이 없는 값(혹시 있다면) — 그대로 둔다
      continue;
    }
    const { prefix } = m.groups;
    const dir = path.posix.dirname(prefix) === "." ? "" : path.posix.dirname(prefix);
    const baseName = path.posix.basename(prefix);

    // 같은 폴더(dir) + 같은 baseName + _v또는-v + 버전 + .txt/.md 인 후보만 추림
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidateRe = new RegExp(`^${escapedBase}[-_]v([\\d._]+)\\.(txt|md)$`, "i");

    let best = null; // { relPath, versionArr }
    for (const relPath of allFiles) {
      const fileDir = path.posix.dirname(relPath) === "." ? "" : path.posix.dirname(relPath);
      if (fileDir !== dir) continue;
      const fileName = path.posix.basename(relPath);
      const cm = fileName.match(candidateRe);
      if (!cm) continue;
      const versionArr = parseVersion(cm[1]);
      if (!best || compareVersions(versionArr, best.versionArr) > 0) {
        best = { relPath, versionArr };
      }
    }

    if (!best) {
      warnings.push(`[경고] "${key}" 의 접두사(${prefix})와 일치하는 파일을 찾지 못했습니다. 수동 확인 필요.`);
      continue;
    }

    if (best.relPath !== currentValue) {
      changes.push({ key, from: currentValue, to: best.relPath });
      manifest[key] = best.relPath;
    }
  }

  return { manifest, changes, warnings };
}

function main() {
  const { manifest, changes, warnings } = buildManifest();

  if (changes.length === 0) {
    console.log("변경 없음 — manifest.json이 이미 최신 버전을 가리킵니다.");
  } else {
    console.log(`${changes.length}건 갱신:`);
    for (const c of changes) {
      console.log(`  ${c.key}: ${c.from}  ->  ${c.to}`);
    }
  }
  for (const w of warnings) console.warn(w);

  if (!CHECK_ONLY && changes.length > 0) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    console.log("manifest.json 저장 완료.");
  } else if (CHECK_ONLY && changes.length > 0) {
    console.log("(--check 모드 — 파일은 수정하지 않았습니다)");
    process.exitCode = 1; // CI에서 "수정 필요" 신호로 쓰기 좋게
  }
}

main();
