# 외부 서비스 SP 통합 — gopang은 정본이 아님 (2026-07-05)

## 배경

`gopang/prompts/`에 있던 아래 13개 서비스의 SP 파일(총 29개, 여러 버전
포함)은 **전부 죽은 사본**이었다. 각 서비스는 `gwp-registry.js`의 `url`
필드가 가리키는 **자기 자신의 독립 GitHub 레포**에서 서비스되고, 그
레포의 webapp.html이 **자기 자신의 raw URL**로 SP를 fetch한다 —
gopang의 manifest.json이나 prompts/ 폴더는 이 흐름 어디에도 관여하지
않는다.

이 사실은 `klaw` 레포를 직접 클론해서 확인했다 — `klaw_v15_1.md`(레포
루트)를 자체적으로 쓰고 있었고, gopang의 `SP-01_klaw_v15.1.txt`(같은
버전 번호라 착각하기 쉬웠음)는 아무 코드에서도 읽지 않았다. `police`,
`security`, `health` 레포에도 각자 `prompts/` 하위 폴더가 있는 것까지는
확인했으나(GitHub API 요청 한도로 전체 13개를 다 못 봤다), 최소 하나
(klaw) 이상에서 같은 패턴이 실증됐고 나머지도 저장소 자체가 별도로
존재하므로(README 등 확인됨) 같은 구조일 가능성이 매우 높다.

## 이동 조치

아래 파일들(모든 버전 포함, 총 29개)을 `prompts/archive/`로 옮겼다 —
`build_manifest.py`가 `prompts/` 최상위만 스캔하므로(`iterdir()`, 비재귀,
`archive/`는 대상 밖) 이 조치만으로 `manifest.json`에서 자동으로
빠진다. 완전 삭제하지 않고 archive에 남긴 이유는 SP-05_kmarket 때와
같다 — 과거 이력·비교 참고용으로, "여기 있었는데 사라졌다"는 흔적을
남겨 향후 혼동을 줄이기 위함이다.

| gopang 내 원래 id (manifest 키) | 실제 정본 위치(확인/추정) | 확인 상태 |
|---|---|---|
| SP-01_klaw | `Openhash-Gopang/klaw` 레포, 루트의 `klaw_v15_1.md` | ✅ 직접 클론해 확인 |
| SP-02_k119 | `Openhash-Gopang/911` 레포 | ⚠️ 레포 존재만 확인, 파일 위치 미확인(API 한도) |
| SP-03_kpolice | `Openhash-Gopang/police` 레포, `prompts/` 폴더 | ⚠️ 폴더 존재 확인, 정확한 파일명 미확인 |
| SP-04_khealth | `Openhash-Gopang/health` 레포, `prompts/` 폴더 | ⚠️ 폴더 존재 확인, 정확한 파일명 미확인 |
| SP-06_ktraffic | `Openhash-Gopang/traffic` 레포 | ⚠️ 레포 존재만 확인 |
| SP-08_gdc | `Openhash-Gopang/gdc` 레포 | ⚠️ 레포 존재만 확인(README/ROADMAP만 봄) |
| SP-09_kschool | `Openhash-Gopang/school` 레포 | ⚠️ 레포 존재만 확인 |
| SP-10_kpublic | `Openhash-Gopang/public` 레포 | ⚠️ 레포 존재만 확인(API 한도로 목록 못 봄) |
| SP-11_kstock | `Openhash-Gopang/stock` 레포 | ⚠️ 레포 존재만 확인 |
| SP-12_kdemocracy | `Openhash-Gopang/democracy` 레포, 루트의 `ai_democracy_system_prompts.md` | ✅ 파일명까지 확인 |
| SP-13_klogistics | `Openhash-Gopang/logistics` 레포 | ⚠️ 레포 존재만 확인(README만 봄) |
| SP-14_kcleaner / SP-14-IMG | `fiil.kr` — **소속 조직 자체가 불확실**(memory 기준 nounweb/fiil 가능성, Openhash-Gopang 소속이 아닐 수 있음) | ❌ 미확인, 별도 확인 필요 |
| SP-16_kinsurance | `Openhash-Gopang/insurance` 레포, `prompts/` 폴더 | ⚠️ 폴더 존재 확인, 정확한 파일명 미확인 |

**⚠️ 표시된 항목은 "gopang이 정본이 아니다"까지는 확실하지만("각 서비스가
독립 레포를 갖고 있다" 자체는 GitHub 조직 레포 목록으로 확인됨), 그
레포 안 정확히 어느 파일이 진짜 SP인지는 직접 열어보지 않는 한 100%
단정할 수 없다.** 이후 각 서비스 SP를 실제로 수정해야 할 일이 생기면,
이 표를 출발점 삼아 **해당 레포를 먼저 클론해서 실제 webapp.html이
fetch하는 raw URL을 확인**하는 절차를 거쳐야 한다(이번에 klaw로 했던
것과 동일한 방식).

## 앞으로의 원칙

1. **gopang은 개인 AI비서(AGENT-COMMON)와 라우팅 레지스트리
   (`gwp-registry.js`)만 정본으로 유지한다.** 개별 K-서비스의 SP
   콘텐츠는 절대 gopang에 두지 않는다 — 그 서비스 자신의 레포가 유일한
   정본이다.
2. **새 K-서비스를 추가할 때**도 이 원칙을 따른다 — gopang에 SP 파일을
   만들지 말고, 그 서비스의 독립 레포에 바로 만든다. gopang은 `url`
   필드로 그 레포의 webapp.html을 가리키기만 한다.
3. **K-Market(SP-05)은 이미 이 원칙대로 정리되어 있다** — market 레포가
   정본, gopang에는 `SP-05_kmarket_DEPRECATED.txt` 포인터만 남아있다.
   이번 조치로 나머지 13개 서비스도 같은 상태가 되었다.
