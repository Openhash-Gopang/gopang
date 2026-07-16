/// <reference path="../pb_data/types.d.ts" />
// PUBLIC-DATA-PORTAL-INTEGRATION 파이프라인 실전 검증용 no-op 마이그레이션.
// 아무 컬렉션도 만들거나 바꾸지 않는다 — 순수하게 배포 파이프라인
// (push -> 변경파일 감지 -> SSH_ORIGINAL_COMMAND 전달 -> 서버 개별
// 다운로드/검증 -> migrate up) 전체가 실제로 작동하는지 확인하기 위함.
migrate((db) => {
  console.log("[pipeline-selftest] no-op migration applied — 2026-07-16");
}, (db) => {
  console.log("[pipeline-selftest] no-op migration reverted");
})
