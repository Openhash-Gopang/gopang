// 2026-08-16 주피터가 실제 OC=openhash 계정으로 law.go.kr을 호출해
// 확보한 진짜 응답(query=경찰청, target=admrul)을 픽스처로 고정한
// 회귀 테스트. 이후 파서를 수정할 때 이 테스트가 계속 통과해야 한다.
import { readFileSync } from 'node:fs';
import { parseAdminRuleListXmlRegexFallback } from '../law-api-client.js';

const xml = readFileSync(new URL('./fixtures_real_response_20260816.xml', import.meta.url), 'utf-8');
const parsed = parseAdminRuleListXmlRegexFallback(xml);

console.log('파싱 항목 수:', parsed.length, parsed.length === 6 ? '(OK)' : '(FAIL, 6 기대)');

const allHaveName = parsed.every(p => p.행정규칙명 && p.행정규칙명.length > 0);
console.log('전 항목 행정규칙명 정상 파싱(CDATA 처리):', allHaveName, allHaveName ? '(OK)' : '(FAIL)');

const first = parsed[0];
console.log('\n첫 항목 검증:');
console.log('  행정규칙명:', first.행정규칙명, first.행정규칙명 === '경찰 소관 회계직 공무원 관직 지정 및 회계사무 취급에 관한 규칙' ? '(OK)' : '(FAIL)');
console.log('  행정규칙종류:', first.행정규칙종류, first.행정규칙종류 === '훈령' ? '(OK)' : '(FAIL)');
console.log('  소관부처명:', first.소관부처명, first.소관부처명 === '경찰청' ? '(OK)' : '(FAIL)');
console.log('  발령일자:', first.발령일자, first.발령일자 === '20250918' ? '(OK)' : '(FAIL)');

const last = parsed[parsed.length - 1];
console.log('\n마지막(경계) 항목 검증:');
console.log('  행정규칙명:', last.행정규칙명, last.행정규칙명 === '경찰청 내부비리신고센터 운영 및 신고자 보호에 관한 규칙' ? '(OK)' : '(FAIL)');

const allPolice = parsed.every(p => p.소관부처명 === '경찰청');
console.log('\n전 항목 소관부처명=경찰청(query 필터링 신뢰성 확인):', allPolice, allPolice ? '(OK)' : '(FAIL)');
