import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { _natAgencyExtractName } from '../worker.js';

// 2026-07-24 발견(§7 동적 조회 100건 사고실험, 주피터 지시) — 예전엔
// 모든 도메인이 하나의 공용 정규식(모든 기관 접미사를 한꺼번에 인식)을
// 써서, domain=prosecution(검찰) 조회인데 검색결과에 "의정부지방법원"이
// 같이 언급돼 있으면 그게 집계돼 이겨서 완전히 다른 기관(법원≠검찰청)을
// verified:true로 잘못 반환했다. 도메인별 접미사 분리로 수정.
describe('_natAgencyExtractName — 도메인 교차오염 방지', () => {
  const organic = [
    { title: '의정부지방법원 관할구역 안내', link: 'https://www.scourt.go.kr/uijeongbu',
      snippet: '의정부지방법원은 경기도 북부 지역(의정부시, 동두천시 등)을 관할합니다.' },
    { title: '의정부지방법원 관할구역 안내', link: 'https://www.scourt.go.kr/uijeongbu2',
      snippet: '경기북부 의정부시 관련 재판은 의정부지방법원에서 진행됩니다.' },
    { title: '전국 지방검찰청 안내', link: 'https://www.spo.go.kr/site',
      snippet: '의정부지방검찰청은 경기도 의정부시, 동두천시 등을 관할하는 검찰청입니다.' },
  ];

  test('prosecution(검찰) 조회는 법원이 아니라 검찰청을 반환해야 한다 — 실제 재현된 버그', () => {
    const result = _natAgencyExtractName(organic, '경기도', 'prosecution', '의정부시');
    assert.equal(result, '의정부지방검찰청');
    assert.notEqual(result, '의정부지방법원');
  });

  test('court(법원) 조회는 여전히 정상적으로 법원을 반환한다(회귀 없음)', () => {
    const result = _natAgencyExtractName(organic, '경기도', 'court', '의정부시');
    assert.equal(result, '의정부지방법원');
  });

  test('police — 2021년 자치경찰제 개편 후 신명칭("OO경찰청", "지방" 없음)도 인식한다', () => {
    const organicPolice = [
      { title: '제주경찰청 소개', link: 'https://www.jeju.police.go.kr',
        snippet: '제주경찰청은 제주특별자치도 전역을 관할합니다.' },
      { title: '제주경찰청', link: 'https://www.jeju.police.go.kr/2',
        snippet: '제주경찰청 민원실 안내.' },
    ];
    const result = _natAgencyExtractName(organicPolice, '제주특별자치도', 'police', null);
    assert.equal(result, '제주경찰청');
  });

  test('police — 구명칭("OO지방경찰청")도 여전히 인식한다(하위호환)', () => {
    const organicOld = [
      { title: '부산지방경찰청', link: 'https://www.busan.police.go.kr',
        snippet: '부산지방경찰청은 부산광역시 전역을 관할합니다.' },
      { title: '부산지방경찰청 소개', link: 'https://www.busan.police.go.kr/2',
        snippet: '부산지방경찰청 민원 안내.' },
    ];
    const result = _natAgencyExtractName(organicOld, '부산광역시', 'police', null);
    assert.equal(result, '부산지방경찰청');
  });
});
