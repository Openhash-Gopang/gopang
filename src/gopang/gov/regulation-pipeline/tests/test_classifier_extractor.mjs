import { passesRegexFilter, classifyRegulation, extractChecklistItems } from '../regulation-classifier-extractor.js';
const proceduralText = "검사 또는 사법경찰관은 피의자를 신문하기 전에 진술거부권을 고지하여야 한다.";
const adminText = "본 규정은 각 부서의 여비 정산 절차와 예산 편성 기준을 정한다.";
console.log('절차 텍스트:', passesRegexFilter(proceduralText), '(true 기대)');
console.log('행정 텍스트:', passesRegexFilter(adminText), '(false 기대)');
const mockAI = async () => JSON.stringify({ is_procedural: true, confidence: 'high', reason: '테스트' });
console.log(await classifyRegulation(proceduralText, mockAI));
let aiCalled = false;
await classifyRegulation(adminText, async () => { aiCalled = true; return '{}'; });
console.log('정규식 미통과시 AI 스킵:', !aiCalled, '(true 기대)');
const mockExtractAI = async () => JSON.stringify([
  { item: 'A', legal_basis: '형사소송법 제1조', mandatory: true },
  { item: 'B', legal_basis: '', mandatory: true },
]);
const extracted = await extractChecklistItems(proceduralText, '테스트기관', mockExtractAI);
console.log('추출 항목 수(legal_basis 없는 건 제외):', extracted.length, '(1 기대)');
