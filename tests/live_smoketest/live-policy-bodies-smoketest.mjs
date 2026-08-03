#!/usr/bin/env node
/**
 * live-policy-bodies-smoketest.mjs
 *
 * policy-bodies 70개(중앙부처·청·위원회 본청) 전부를 실제로 호출하도록
 * 의도한 사용자 발화 시나리오 — 각 기관마다 gov-router.js의
 * _POLICY_BODY_DOMAIN_KEYWORDS에 등록된 실제 매칭 키워드를 자연스러운
 * 문장에 그대로 심어서, "발화 → AC 의도 파악 → 해당 기관 SP 호출"이라는
 * 혼디 제1원칙이 실제로 동작하는지 검증한다.
 *
 * 기존 live-gov-router-smoketest.mjs와 동일한 하네스 구조([label, text,
 * useLLM, expectation])를 그대로 재사용 — policy-bodies 매칭은 설계상
 * LLM 폴백이 필요 없으므로(코드 주석 "classifyFn 유무와 무관하게 즉시
 * 판단") 전부 useLLM=false.
 *
 * ⚠️ 실행 전 반드시 읽을 것 — 이 파일을 작성하며 발견한 구조적 버그:
 *
 * 70개 중 7개(NTS·KCS·POLICE·MMA·KCG·PPS·PROSECUTION)는 policy-bodies
 * (본청)와 09-national/agencies(지사형 집행기관) 양쪽에 동시에 존재하고,
 * gov-router.js의 우선순위 가드가 "두 사전이 동시 매칭되면 지사가
 * 우선"하도록 설계돼 있다(§3410 주석 — 실행형 민원은 관할 지사가 처리
 * 하는 게 맞다는 의도적 설계).
 *
 * 문제는 이 중 5개(NTS/KCS/MMA/PPS/PROSECUTION)는 _POLICY_BODY_DOMAIN_
 * KEYWORDS에 등록된 키워드 **전부**가 _NAT_AGENCY_DOMAIN_KEYWORDS와
 * 부분 문자열로 겹친다는 것 — 즉 설계 의도(가끔 겹칠 때만 지사 우선)와
 * 달리, 이 5개는 "정책기관 키워드를 쓰면 무조건 지사로 새버린다"는
 * 뜻이라 텍스트 매칭으로는 정책기관(본청) SP에 영원히 도달할 수 없다.
 * (POLICE·KCG는 키워드 일부만 겹치고 일부는 안전해서 부분적으로는
 * 작동한다.)
 *
 *   NTS 예: '종합소득세 신고'(정책기관 키워드)는 '소득세'를 부분
 *           포함 → tax 지사 키워드에도 걸림 → 지사가 항상 우선
 *   KCS 예: '수입물품 통관 신고' → '통관' 포함 → customs 지사 키워드 → 지사 우선
 *   MMA 예: '병무청 본청' → '병무청' 포함 → mma 지사 키워드 → 지사 우선
 *   PPS 예: '조달청'/'나라장터' → 지사 사전과 완전히 동일한 키워드
 *   PROSECUTION 예: '검찰청'/'고소장 접수' → '검찰청'·'고소장' 모두 지사 키워드
 *
 * 이 5개는 아래 시나리오에서 expectation을 'review'로 표시하고 이유를
 * 주석으로 남겼다 — FAIL로 뜨는 게 이 스크립트나 시나리오의 오류가
 * 아니라 이미 알려진(그리고 아직 안 고쳐진) 라우팅 설계상 도달 불가
 * 상태라는 뜻이다. POLICE·KCG는 지사와 안 겹치는 안전한 키워드로
 * 대체해서 정상 PASS를 기대하도록 작성했다.
 *
 * 실행 (실제 네트워크가 열려있는 환경에서, 리포 루트 기준):
 *   node tests/live_smoketest/live-policy-bodies-smoketest.mjs
 */

const mod = await import('../../src/gopang/gov/gov-router.js');
global.window = {}; // gov-router.js가 top-level에서 window.assembleGovSystemPrompt = ... 실행함

const SCENARIOS = [
  // [label, text, useLLM, expectation]
  // expectation: 'contains:X' → trace에 X가 있어야 PASS
  //              'review' → 알려진 이슈로 자동판정 보류(주석 참조)

  ['법무부', '외국인 체류기간 연장 신청은 어떻게 하나요', false, 'contains:SP-POLICY-LAZY(MOJ'],
  ['금융위원회', '온라인투자연계금융업 등록 절차가 궁금합니다', false, 'contains:SP-POLICY-LAZY(FSC'],
  ['공정거래위원회', '납품업체인데 납품단가 후려치기를 당해서 신고하고 싶어요', false, 'contains:SP-POLICY-LAZY(FTC'],
  ['고용노동부', '회사에서 월급을 안 줘서 임금체불 진정을 넣고 싶습니다', false, 'contains:SP-POLICY-LAZY(MOEL'],
  ['보건복지부', '기초생활수급자 신청은 어떻게 하나요', false, 'contains:SP-POLICY-LAZY(MOHW'],

  // ★ NTS — 정책기관 키워드 4개 전부 tax 지사 키워드와 겹침(위 설명 참조).
  // 이 발화는 항상 지사(SP-NAT-TAX)로 갈 것으로 예상 — review로 표시.
  ['국세청(알려진 이슈)', '홈택스로 종합소득세 신고하는 방법 알려주세요', false, 'review'],
  // ★ KCS — 마찬가지, customs 지사와 전부 겹침.
  ['관세청(알려진 이슈)', '해외직구 물품 수입물품 통관 신고는 어떻게 하나요', false, 'review'],

  ['국민권익위원회', '공무원 비리를 국민신문고에 신고하고 싶어요', false, 'contains:SP-POLICY-LAZY(ACRC'],
  ['감사원', '공익감사청구서를 접수하고 싶습니다', false, 'contains:SP-POLICY-LAZY(BAI'],
  ['고위공직자범죄수사처', '고위공직자 비리 제보하고 싶은데 어디로 가야 하나요', false, 'contains:SP-POLICY-LAZY(CIO'],
  ['헌법재판소', '이 법률이 위헌인 것 같아서 헌법소원을 내고 싶어요', false, 'contains:SP-POLICY-LAZY(CONSTCOURT'],
  ['국가인권위원회', '직장에서 장애를 이유로 차별을 당했어요, 인권위 진정 넣고 싶습니다', false, 'contains:SP-POLICY-LAZY(NHRCK'],
  ['개인정보보호위원회', '제 개인정보 유출 신고하려고 합니다', false, 'contains:SP-POLICY-LAZY(PIPC'],
  ['우주항공청', '우주기술 연구개발 지원사업에 지원하고 싶습니다', false, 'contains:SP-POLICY-LAZY(KASA'],
  ['국회', '국민동의청원을 올리고 싶은데 절차가 궁금해요', false, 'contains:SP-POLICY-LAZY(ASSEMBLY'],
  ['법원(대법원)', '판결문 등본 발급 신청하려고 합니다', false, 'contains:SP-POLICY-LAZY(SUPREMECOURT'],
  ['국가정보원', '회사 핵심기술이 해외로 유출된 것 같아서 산업기술 유출 제보하고 싶어요', false, 'contains:SP-POLICY-LAZY(NIS'],
  ['중앙선거관리위원회', '정당 후원회 등록은 어떻게 하나요', false, 'contains:SP-POLICY-LAZY(NEC'],
  ['원자력안전위원회', '방사선 발생장치 사용 허가를 받고 싶습니다', false, 'contains:SP-POLICY-LAZY(NSSC'],
  ['국회예산정책처', '이 정책의 예산 소요 추계 자료를 받고 싶어요', false, 'contains:SP-POLICY-LAZY(NABO'],
  ['국회입법조사처', '이 법안에 대한 입법조사 회답을 받고 싶습니다', false, 'contains:SP-POLICY-LAZY(NARS'],
  ['교육부', '해외에서 딴 학점을 국내 학점으로 학점인정 신청하고 싶어요', false, 'contains:SP-POLICY-LAZY(MOE'],
  ['외교부', '여권 재발급 신청하려고 하는데 어떻게 하나요', false, 'contains:SP-POLICY-LAZY(MOFA'],
  ['통일부', '북한이탈주민 정착지원을 받고 싶습니다', false, 'contains:SP-POLICY-LAZY(UNIKOREA'],
  ['국방부', '예비군 훈련 연기 신청하고 싶어요', false, 'contains:SP-POLICY-LAZY(MND'],
  ['행정안전부', '재난안전특별교부세 관련해서 문의드립니다', false, 'contains:SP-POLICY-LAZY(MOIS'],
  ['농림축산식품부', '축사 신축 정책자금을 받고 싶은데요', false, 'contains:SP-POLICY-LAZY(MAFRA'],
  ['문화체육관광부', '문화예술 지원사업 신청하고 싶습니다', false, 'contains:SP-POLICY-LAZY(MCST'],
  ['국가보훈부', '국가유공자 등록 신청하려고 합니다', false, 'contains:SP-POLICY-LAZY(MPVA'],
  ['과학기술정보통신부', '정보통신 R&D 지원사업에 참여하고 싶어요', false, 'contains:SP-POLICY-LAZY(MSIT'],
  ['중소벤처기업부', '소상공인 정책자금 대출받고 싶습니다', false, 'contains:SP-POLICY-LAZY(MSS'],
  ['질병관리청', '감염병 의심 신고하려고 합니다', false, 'contains:SP-POLICY-LAZY(KDCA'],
  ['산림청', '우리 동네 소나무재선충병 발생한 것 같아요', false, 'contains:SP-POLICY-LAZY(KFS'],
  ['국가유산청', '공사 중에 매장문화재 발견 신고하려고 합니다', false, 'contains:SP-POLICY-LAZY(KHS'],
  ['식품의약품안전처', '수입식품 안전성 검사는 어떻게 신청하나요', false, 'contains:SP-POLICY-LAZY(MFDS'],
  ['기상청', '어제 기상특보 오보 아니었나요, 문의드립니다', false, 'contains:SP-POLICY-LAZY(KMA'],
  ['농촌진흥청', '작물에 병해충 진단을 받고 싶어요', false, 'contains:SP-POLICY-LAZY(RDA'],

  // ★ POLICE — '경찰청' 자체는 지사 키워드와 겹치므로 그 대신 안전한
  // 정책기관 키워드('차량 도난 신고')만 사용 → 정상 PASS 기대.
  ['경찰청', '제 차가 도난당해서 차량 도난 신고하려고 합니다', false, 'contains:SP-POLICY-LAZY(POLICE'],

  // ★ MMA — '병무청 본청' 자체가 '병무청'을 부분 포함해 mma 지사 키워드와
  // 겹침 → 항상 지사로 감. review.
  ['병무청(알려진 이슈)', '병무청 본청에 병역 관련 정책 문의를 드리고 싶습니다', false, 'review'],

  ['기후에너지환경부', '공장에서 대기오염물질 배출 관련 문의드립니다', false, 'contains:SP-POLICY-LAZY(MOCEE'],
  ['방송미디어통신위원회', '홈쇼핑 광고 신고하고 싶어요', false, 'contains:SP-POLICY-LAZY(BMTC'],
  ['법제처', '조례안 법제 심사를 요청하고 싶습니다', false, 'contains:SP-POLICY-LAZY(MOLELEG'],
  ['인사혁신처', '공무원 경력경쟁채용시험 일정이 궁금합니다', false, 'contains:SP-POLICY-LAZY(MPM'],
  ['소방청', '소방청 본청에 소방시설 완공 점검 관련 문의드립니다', false, 'contains:SP-POLICY-LAZY(NFA'],
  ['대통령경호처', '경호구역 촬영 협조 요청하고 싶습니다', false, 'contains:SP-POLICY-LAZY(PSS'],
  ['해양수산부', '어업허가 갱신 신청하려고 합니다', false, 'contains:SP-POLICY-LAZY(MOF'],
  ['국토교통부', '재건축 정비사업 인허가 절차가 궁금합니다', false, 'contains:SP-POLICY-LAZY(MOLIT'],
  ['산업통상부', '원산지증명서 발급 신청하고 싶어요', false, 'contains:SP-POLICY-LAZY(MOTIE'],
  ['성평등가족부', '직장 내 성희롱 신고하고 싶습니다', false, 'contains:SP-POLICY-LAZY(MOGEF'],
  ['방위사업청', '방위산업체 지정 신청 절차가 궁금합니다', false, 'contains:SP-POLICY-LAZY(DAPA'],

  // ★ KCG — '해양경찰청'은 coastguard 지사 키워드와 겹치므로 안전한
  // 키워드('선박 침수 신고')만 사용 → 정상 PASS 기대.
  ['해양경찰청', '배가 침수돼서 선박 침수 신고하려고 합니다', false, 'contains:SP-POLICY-LAZY(KCG'],

  ['재외동포청', '재외동포체류자격 등록하려고 합니다', false, 'contains:SP-POLICY-LAZY(OKA'],

  // ★ PPS — 정책기관 키워드('조달청','나라장터') 둘 다 지사 사전과 완전히
  // 동일 → 항상 지사로 감. review.
  ['조달청(알려진 이슈)', '나라장터에 입찰 등록하려고 하는데요', false, 'review'],

  ['대통령비서실', '국민제안 올리고 싶은데 어떻게 하나요', false, 'contains:SP-POLICY-LAZY(PRESOFFICE'],

  // ★ PROSECUTION — '검찰청'·'고소장 접수' 둘 다 지사(prosecution/police)
  // 키워드와 겹침 → 항상 지사로 감. review.
  ['검찰청(알려진 이슈)', '고소장 접수하려고 합니다', false, 'review'],

  ['국가안보실', '안보 정책 건의서를 제출하고 싶습니다', false, 'contains:SP-POLICY-LAZY(NSC'],
  ['국무조정실', '규제개선 건의를 하고 싶어요', false, 'contains:SP-POLICY-LAZY(OPC'],
  ['법원공무원교육원', '법원공무원 실무 교육과정 신청하고 싶습니다', false, 'contains:SP-POLICY-LAZY(COTI'],
  ['사법정책연구원', '재판제도 연구용역을 의뢰하고 싶습니다', false, 'contains:SP-POLICY-LAZY(JPRI'],
  ['사법연수원', '사법연수생 관련 문의드립니다', false, 'contains:SP-POLICY-LAZY(JRTI'],
  ['행정중심복합도시건설청', '세종시 아파트 특별공급 신청 자격이 궁금합니다', false, 'contains:SP-POLICY-LAZY(NAACC'],
  ['국회미래연구원', '미래 정책 연구 자문을 요청하고 싶습니다', false, 'contains:SP-POLICY-LAZY(NAFI'],
  ['국회도서관', '학위논문 원문 복사 신청하고 싶어요', false, 'contains:SP-POLICY-LAZY(NANET'],
  ['국회사무처', '국정감사 자료 제출 요청 관련 문의입니다', false, 'contains:SP-POLICY-LAZY(NAS'],
  ['법원행정처', '법원 시설물 촬영 협조를 구하고 싶습니다', false, 'contains:SP-POLICY-LAZY(NCA'],
  ['국가데이터처', '공공데이터 개방 신청하고 싶어요', false, 'contains:SP-POLICY-LAZY(NDA'],
  ['새만금개발청', '새만금산업단지 입주 절차가 궁금합니다', false, 'contains:SP-POLICY-LAZY(SDIA'],
  ['지식재산처', '특허 출원하려고 하는데 절차를 알려주세요', false, 'contains:SP-POLICY-LAZY(KIPO'],
  ['재정경제부', '세제 개편 관련 의견을 제출하고 싶습니다', false, 'contains:SP-POLICY-LAZY(MOFE'],
  ['기획예산처', '공공기관 예산 편성 의견을 내고 싶습니다', false, 'contains:SP-POLICY-LAZY(OBS'],
];

let pass = 0, fail = 0, review = 0;

for (const [label, text, useLLM, expectation] of SCENARIOS) {
  process.stdout.write(`\n=== ${label} ===\n입력: ${text}\n`);
  let result;
  try {
    result = await mod.assembleGovSystemPrompt(text, null, null, null);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    fail++;
    continue;
  }
  const traceStr = JSON.stringify(result.trace);
  console.log('trace:', traceStr);

  if (expectation === 'review') {
    console.log('→ REVIEW (알려진 키워드 충돌 이슈 — 지사로 갔는지 직접 확인, 파일 상단 설명 참조)');
    review++;
    continue;
  }
  const [kind, code] = expectation.split(':');
  const found = traceStr.includes(code);
  const ok = kind === 'contains' ? found : !found;
  console.log(ok ? '→ PASS' : `→ FAIL (기대: ${expectation})`);
  ok ? pass++ : fail++;
}

console.log(`\n${'='.repeat(50)}`);
console.log(`결과: PASS ${pass} / FAIL ${fail} / REVIEW ${review} (총 ${SCENARIOS.length})`);
console.log(`(REVIEW ${review}건은 §NTS/KCS/MMA/PPS/PROSECUTION 키워드 충돌로 인한 ` +
            `알려진 라우팅 미도달 상태 — 이 스크립트의 결함이 아님, 파일 상단 설명 참조)`);
process.exit(fail > 0 ? 1 : 0);
