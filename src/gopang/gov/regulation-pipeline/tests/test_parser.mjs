import { parseAdminRuleListXmlRegexFallback } from '../law-api-client.js';
const mockXml = `<법령검색><법령><행정규칙일련번호>2100000264562</행정규칙일련번호><행정규칙명>테스트</행정규칙명><행정규칙종류>훈령</행정규칙종류><발령일자>20250918</발령일자><발령번호>1</발령번호><소관부처명>경찰청</소관부처명><현행연혁구분>현행</현행연혁구분><제개정구분코드>200403</제개정구분코드><제개정구분명>일부개정</제개정구분명><행정규칙ID>93751</행정규칙ID><행정규칙상세링크>/x</행정규칙상세링크><시행일자>20250624</시행일자><생성일자>20250901</생성일자></법령></법령검색>`;
const parsed = parseAdminRuleListXmlRegexFallback(mockXml);
console.log('파싱된 항목 수:', parsed.length, parsed.length === 1 ? '(OK)' : '(FAIL)');
console.log(JSON.stringify(parsed, null, 2));
