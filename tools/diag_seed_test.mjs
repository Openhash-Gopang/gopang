const record = {
  tier: 'emd',
  도코드: 'busan',
  읍면동명: '우1동',
  generated_content: '진단용 테스트 본문입니다. 최소 300자를 넘겨야 검증을 통과하지만 이건 원본 응답 확인용이라 실패해도 상관없습니다. 나무위키 확인. 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복 반복.',
  institution: '진단테스트',
};

console.log('요청 바디:', JSON.stringify({ records: [record] }).slice(0, 200), '...');

const res = await fetch('https://hondi-proxy.tensor-city.workers.dev/gov-tree-instance/seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ records: [record] }),
});

console.log('HTTP 상태:', res.status, res.statusText);
console.log('응답 헤더 content-type:', res.headers.get('content-type'));
const text = await res.text();
console.log('원본 응답 본문(텍스트):');
console.log(text);
try {
  const json = JSON.parse(text);
  console.log('파싱된 JSON:', JSON.stringify(json, null, 2));
} catch (e) {
  console.log('JSON 파싱 실패:', e.message);
}
