# Openhash L1~L5 물리 서버 증설 절차서
**작성일**: 2026-07-08 (제주도 서귀포시 L1 17개 노드 이관 작업 기준)
**대상**: 타 시/도에 Openhash L1~L5 계층형 원장 시스템을 신규 구축할 때 참고

---

## 0. 이 문서의 전제

- 계층 정의: **읍면동 = L1**, **시/군/구 = L2**, **도/특별자치도 = L3**, **국가 = L4**, **글로벌 = L5**
- 예시 서버: `l1-hanlim`(168.110.123.175, 기존), `seogwipo-l1-nodes`(158.180.84.57, 신규)
- 클라우드: Oracle Cloud Infrastructure (OCI) Always Free
- 백엔드: PocketBase 0.22.14 (인스턴스별 독립 SQLite), 프록시: nginx + Cloudflare Worker

---

## 1. 서버 증설이 필요한지 먼저 진단하라

### 1.1 현재 서버가 실제로 무엇인지부터 확인 (추측 금지)

```bash
curl -s -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/ | python3 -m json.tool
```

이 메타데이터 엔드포인트는 인스턴스 자기 자신에게 물어보는 것이라 콘솔 로그인 없이 즉시 확인 가능하다. 확인할 값:
- `shape` — `VM.Standard.E2.1.Micro`(AMD Micro, 1 OCPU/1GB)인지 `VM.Standard.A1.Flex`(Ampere)인지
- `region`, `canonicalRegionName`

> **실제 사례**: hanlim 서버는 겉보기엔 "Oracle Free Tier"라고만 알고 있었으나, 실측 결과 `VM.Standard.E2.1.Micro`(1GB)였다. 훨씬 큰 A1.Flex 무료 할당량(2 OCPU/12GB, 2026-06-15부로 4/24에서 축소됨)을 손도 안 댄 채 가장 작은 옵션으로 운영되고 있었다. **반드시 실측하고, "그냥 Free Tier니까 여유 있겠지"라고 가정하지 말 것.**

### 1.2 메모리 실측 후 증설 여부 판단

```bash
free -h
ps aux | grep pocketbase | grep -v grep   # 인스턴스 1개당 실제 RSS 확인
```

- 참고 수치: PocketBase 인스턴스 1개당 RSS **약 46MB** (2026-07-08 실측)
- 계산식: `(예정 L1 노드 수) × 46MB` vs `free -h`의 available
- 여유가 빠듯하면(예: available < 필요량의 1.5배) 스왑부터 늘리고, 그래도 부족하면 서버 증설

### 1.3 A1.Flex "무료 이전"이 가능한지 반드시 사전 확인 — 불가능한 경우가 많다

**막힐 수 있는 지점 3가지, 전부 실제로 겪음:**

1. **리전 제약**: A1.Flex는 일부 리전에서 생성 자체가 불가 (예: South Korea North/춘천). 콘솔에서 인스턴스 생성 화면까지 들어가서 shape 목록에 A1.Flex가 뜨는지 직접 확인해야 한다.
2. **타 리전 구독 제약**: Always Free 계정은 **홈 리전 하나만** 구독 가능. 다른 리전(예: 서울)을 쓰려면 리전 구독이 필요한데, Free 계정은 이 구독 자체가 막혀 있다("To access more regions, you must upgrade to a paid account"). 확인 명령:
   ```bash
   oci iam region-subscription list --tenancy-id "$TENANCY_ID" --output table
   ```
3. **Always Free A1 한도 자체가 축소됨** (2026-06-15부): 4 OCPU/24GB → 2 OCPU/12GB. PAYG 전환 시엔 매월 3,000 OCPU-시간 + 18,000 GB-시간(≈4 OCPU/24GB 상시) 무료 유지.

**결론**: 위 세 가지가 모두 막히면, 남는 선택지는 **같은 리전에 AMD Micro 인스턴스를 추가**(Always Free는 AMD Micro 최대 2개 허용)하는 것뿐이다. 이 경우 비용은 $0.

---

## 2. OCI CLI 설치 및 인증 (신규 서버 관리용)

### 2.1 설치

```bash
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
export PATH="$HOME/bin:$PATH"   # 설치 후 매 세션 필요, ~/.bashrc에 추가 권장
```

> **주의**: 1GB급 서버에서는 `cryptography` 등 C 확장 모듈 컴파일에 CPU 59% 이상 점유하며 2분 이상 걸릴 수 있다. **멈춘 것처럼 보여도 `ps aux`로 CPU%가 0이 아니면 정상 진행 중이니 Ctrl+C 금지.**

### 2.2 인증 설정

```bash
oci setup config
```
- Region 선택 시 **인덱스 번호를 두 번 확인할 것** — 비슷한 이름(`ap-chuncheon-1` vs `ap-chuncheon-2`)이 붙어 있어 오타 나기 쉽다. 잘못 선택했으면:
  ```bash
  sed -i 's/ap-chuncheon-2/ap-chuncheon-1/' ~/.oci/config
  ```
- Passphrase 질문에 **Enter로 건너뛸 수 없다** — 반드시 문자 그대로 `N/A`를 입력해야 한다.
- 생성된 공개키(`~/.oci/oci_api_key_public.pem`)를 콘솔 **My Profile → Tokens and keys → API Keys → Add API Key → Paste a public key**에 등록해야 인증이 완성된다. (Details 탭이 아니라 **Tokens and keys** 탭에 있음 — 헷갈리기 쉬움)

### 2.3 연결 테스트

```bash
oci iam region list --output table
```

---

## 3. 신규 인스턴스 생성 (CLI)

### 3.1 기존 인스턴스에서 필요한 값 조회

```bash
HANLIM_ID="ocid1.instance.oc1...."   # 기존 인스턴스 OCID

# shape, AD 확인
oci compute instance get --instance-id "$HANLIM_ID" \
  --query "data.{shape:shape, ad:\"availability-domain\"}" --output table

# 동일 이미지 OCID 확인 (같은 shape 기준)
oci compute image list --compartment-id "$COMPARTMENT_ID" \
  --operating-system "Canonical Ubuntu" --shape "VM.Standard.E2.1.Micro" \
  --query "data[0].{id:id, name:\"display-name\"}" --output table

# 서브넷 확인 (같은 VCN 재사용)
VNIC_ID=$(oci compute vnic-attachment list --compartment-id "$COMPARTMENT_ID" \
  --instance-id "$HANLIM_ID" --query "data[0].\"vnic-id\"" --raw-output)
oci network vnic get --vnic-id "$VNIC_ID" --query "data.\"subnet-id\"" --raw-output

# 기존 boot volume 크기 확인 (200GB Always Free 한도 안에 드는지)
BV_ID=$(oci compute boot-volume-attachment list --compartment-id "$COMPARTMENT_ID" \
  --availability-domain "<AD>" --instance-id "$HANLIM_ID" \
  --query "data[0].\"boot-volume-id\"" --raw-output)
oci bv boot-volume get --boot-volume-id "$BV_ID" --query "data.\"size-in-gbs\"" --raw-output
```

### 3.2 명명 규칙 — 반드시 사전에 정할 것 (나중에 바꾸면 DNS·인증서까지 재작업)

**흔한 실수**: 물리 호스트 이름에 논리적 노드 계층명(`l1-`, `l2-`)을 그대로 붙이면 오해를 유발한다.
- ❌ `l1-seogwipo` — 마치 "서귀포"라는 단일 L1 노드가 있는 것처럼 오인됨
- ❌ `l2-seogwipo` — 실제 L2(서귀포시 집계 노드)와 이름이 충돌함 (L2는 계속 원래 서버에 있을 수 있음)
- ✅ `seogwipo-l1-nodes` — "서귀포시 관할 L1(읍면동) 노드들을 담는 물리 호스트"라는 의미가 명확

이름을 짓기 전에 스스로에게 물을 것: **"이 물리 서버 자신이 특정 계층의 논리 노드인가, 아니면 여러 노드를 담는 그릇일 뿐인가?"** hanlim처럼 자기 자신도 L1 노드 하나(한림읍)면서 동시에 다른 노드도 호스팅하는 경우와, 이번 신규 서버처럼 순수히 "담는 그릇" 역할만 하는 경우는 네이밍 규칙이 달라야 한다.

### 3.3 인스턴스 생성

```bash
oci compute instance launch \
  --compartment-id "$COMPARTMENT_ID" \
  --availability-domain "<기존과 동일 AD>" \
  --shape "VM.Standard.E2.1.Micro" \
  --display-name "<확정한 이름>" \
  --hostname-label "<확정한 이름>" \
  --image-id "<3.1에서 확인한 이미지 OCID>" \
  --subnet-id "<3.1에서 확인한 서브넷 OCID>" \
  --assign-public-ip true \
  --ssh-authorized-keys-file <(echo "<기존과 동일 공개키 — 키 재사용으로 관리 단순화>") \
  --query "data.{id:id, state:\"lifecycle-state\"}" --output table
```

> Always Free는 AMD Micro 최대 2개, boot volume 총 200GB 한도(계정 전체 공유) — 미리 여유를 계산해둘 것.

### 3.4 이름을 나중에 바꿔야 하는 경우 (놓친 부분을 뒤늦게 고칠 때)

```bash
oci compute instance update --instance-id "<OCID>" \
  --display-name "<새 이름>" --query "data.{name:\"display-name\", state:\"lifecycle-state\"}" --output table
```
```bash
# 서버 자체 hostname도 별도로 바꿔야 함 (인스턴스 표시명과 OS hostname은 별개)
sudo hostnamectl set-hostname <새 이름>
sudo sed -i 's/<옛 이름>/<새 이름>/' /etc/hosts
```

---

## 4. PocketBase 환경 구축

### 4.1 스왑 필수 (1GB급 서버는 스왑 없이 운영 불가)

```bash
sudo fallocate -l 2G /swapfile      # 파일럿 규모면 2G, 필요시 나중에 확장
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
스왑 확장이 필요해지면 기존 스왑을 끄고 지운 뒤 재생성:
```bash
sudo swapoff /swapfile && sudo rm /swapfile
sudo fallocate -l 10G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

### 4.2 필수 패키지 (한 번에 설치 — 하나씩 하다 놓치기 쉬움)

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-pip git nginx unzip certbot python3-certbot-nginx
```

### 4.3 PocketBase 바이너리 — 반드시 기존 서버와 동일 버전

```bash
sudo mkdir -p /opt/gopang/pb
sudo chown -R ubuntu:ubuntu /opt/gopang
cd /opt/gopang
curl -Lo pocketbase.zip https://github.com/pocketbase/pocketbase/releases/download/v0.22.14/pocketbase_0.22.14_linux_amd64.zip
unzip pocketbase.zip pocketbase
chmod +x pocketbase
rm pocketbase.zip
./pocketbase --version   # 기존 서버와 버전 일치 확인
```
버전이 다르면 스키마 호환성 문제가 생길 수 있으니, 기존 서버에서 `/opt/gopang/pocketbase --version`으로 먼저 확인하고 맞출 것.

---

## 5. 파일 이관 — hanlim(서버1)에서 신규 서버로

**서버 간 직접 scp는 안 된다** — 개인키가 로컬 PC에만 있어야 하므로, 반드시 **로컬 PC를 경유**한다.

```powershell
# 로컬 PC에서: 서버1 → 로컬
scp -i "<key>" ubuntu@<서버1_IP>:/opt/gopang/pb_hooks/main.pb.js "$HOME\Downloads\main.pb.js"
scp -i "<key>" ubuntu@<서버1_IP>:~/topology.json "$HOME\Downloads\topology.json"
scp -i "<key>" ubuntu@<서버1_IP>:~/provision-l1-nodes.py "$HOME\Downloads\provision-l1-nodes.py"
scp -i "<key>" ubuntu@<서버1_IP>:~/verify-collections.py "$HOME\Downloads\verify-collections.py"

# 로컬 PC에서: 로컬 → 신규 서버
scp -i "<key>" "$HOME\Downloads\main.pb.js" ubuntu@<신규서버_IP>:/tmp/main.pb.js
scp -i "<key>" "$HOME\Downloads\topology.json" ubuntu@<신규서버_IP>:~/topology.json
scp -i "<key>" "$HOME\Downloads\provision-l1-nodes.py" ubuntu@<신규서버_IP>:~/provision-l1-nodes.py
scp -i "<key>" "$HOME\Downloads\verify-collections.py" ubuntu@<신규서버_IP>:~/verify-collections.py
```

**전송 확인을 절대 생략하지 말 것**:
```bash
ls -la ~/*.py ~/topology.json
```
> **실제 사례**: `verify-collections.py` 전송이 조용히 실패했는데(파일이 아니라 빈 디렉토리로 생성됨) 바로 실행 시도해서 `can't find '__main__' module` 에러로 뒤늦게 발견. 매번 전송 직후 `ls -la`로 실제 파일인지, 크기가 0이 아닌지 확인할 것.

```bash
mkdir -p /opt/gopang/pb_hooks
mv /tmp/main.pb.js /opt/gopang/pb_hooks/main.pb.js
```

---

## 6. provision-l1-nodes.py — 알려진 버그와 수정본 사용

원본 스크립트에 두 가지 치명적 버그가 있었고, 이번 세션에서 패치했다. **패치된 최신본을 반드시 사용할 것** (git 리포의 `ops/jeju-l1-l3-2026-07-07/provision-l1-nodes.py`).

### 6.1 버그 1 — root 권한 mkdir이 크래시 루프를 유발

**증상**: `Error: unable to open database file: out of memory (14)` (사실은 메모리와 무관, 권한 문제) + `types.d.ts: permission denied`. systemd가 5초 간격으로 무한 재시작.

**원인**: 스크립트가 systemd unit 파일(`/etc/systemd/system/`) 쓰기 때문에 `sudo`(root)로 실행되는데, 같은 스크립트 안의 `mkdir`도 root 권한으로 실행되어 디렉토리가 `root:root` 소유가 됨. 정작 PocketBase 프로세스는 `ubuntu` 계정으로 도는데(systemd `User=ubuntu`), 그 계정이 자기 데이터 디렉토리에 쓰기 권한이 없어 발생.

**수정**: `mkdir` 직후 `chown -R {run_user}:{run_user}` 추가 (패치 완료됨).

### 6.2 버그 2 — 서버 과부하 시 응답 오탐

**증상**: 로그에 `생성 스킵/실패(400)`가 대량으로 찍히는데, 실제로는 성공한 경우가 다수 (직접 GET으로 재확인하면 이미 존재함).

**원인**: 다수 노드를 연달아 provisioning하면서 서버 부하(스왑 사용 1GB+, load average 2.0+)가 심해지면, PocketBase가 SQLite 커밋은 성공하고도 HTTP 응답을 제대로 못 돌려주는 경우가 발생. 클라이언트는 이걸 실패로 오인.

**수정**: `create_collection()`/`clone_collection_schema()`가 POST 실패 시 곧바로 실패로 단정하지 않고, GET으로 실제 존재 여부를 재확인 후 `[+]`(신규성공)/`[=]`(이미존재, 정상)/`[X]`(진짜실패) 세 단계로 구분하도록 수정. `main()` 끝에 "진짜 실패 요약" 섹션 추가 — **로그 중간의 `[.]`/`[!]` 표시를 곧이곧대로 믿지 말고, 항상 이 요약 섹션 또는 `verify-collections.py`로 최종 확인할 것.**

### 6.3 사용법 (여러 노드 동시 처리, source-base는 원격 지정 가능)

```bash
export L1_ADMIN_EMAIL="<기존과 동일>"
export L1_ADMIN_PASSWORD="<기존과 동일>"

# 1) dry-run 먼저
python3 provision-l1-nodes.py \
  --only l1-node1,l1-node2,... \
  --source-base http://<서버1_IP>:8091 \
  --admin-email "$L1_ADMIN_EMAIL" --admin-password "$L1_ADMIN_PASSWORD" \
  --dry-run

# 2) 실제 실행 (sudo -E 필수 — 환경변수 유지)
sudo -E python3 provision-l1-nodes.py \
  --only l1-node1,l1-node2,... \
  --source-base http://<서버1_IP>:8091 \
  --admin-email "$L1_ADMIN_EMAIL" --admin-password "$L1_ADMIN_PASSWORD" \
  2>&1 | tee provision-$(date +%Y%m%d).log
```

**`--source-base`를 원격 IP로 지정하려면, 대상 포트(기본 8091)가 두 서버 사이에서 실제로 열려있어야 한다 — §8 네트워크 설정을 먼저 끝낼 것.**

### 6.4 l3(또는 상위 계층) 등록은 반드시 그 노드가 실제로 있는 서버에서 로컬로 실행

```bash
# 신규 서버가 아니라, l3 노드가 있는 서버1에서:
python3 provision-l1-nodes.py \
  --only <topology.json에 없는 더미 이름>  \
  --source-base http://127.0.0.1:8091 \
  --l3-base http://127.0.0.1:8094 \
  --admin-email "$L1_ADMIN_EMAIL" --admin-password "$L1_ADMIN_PASSWORD"
```
(`--only`에 존재하지 않는 이름을 주면 신규 L1 루프는 0건으로 건너뛰고, hanlim/l3 등록 단계만 실행됨 — l3 재등록만 하고 싶을 때 유용)

> **실수 사례**: 신규 서버에서 `--l3-base http://<서버1_IP>:8094`로 원격 지정 시도 → 그 포트가 로컬 전용 바인딩(`127.0.0.1`)이라 8091과 달리 외부 노출이 안 되어 있었음. Security List를 열어도 소용없었다(포트 자체가 로컬 전용). **L2/L3처럼 로컬 전용으로 바인딩된 상위 계층 노드는 원격에서 건드리지 말고, 그 노드가 있는 서버에서 직접 실행하는 게 항상 더 안전하다.**

---

## 7. 검증 — 로그를 믿지 말고 항상 직접 조회

`verify-collections.py`로 각 노드에 실제로 필요한 컬렉션(`blocks`, `gdc_keys`, `l1_ledger`, `bridge_out`, `bridge_in`)이 존재하는지 직접 GET으로 확인한다.

```bash
python3 verify-collections.py --admin-email "$L1_ADMIN_EMAIL" --admin-password "$L1_ADMIN_PASSWORD"
```

**주의**: 이 스크립트는 `topology.json`의 **전체** 노드를 순회한다. 신규 서버에서 실행하면, 그 서버에 없는(다른 서버에 있는) 노드들은 당연히 `FAIL`로 나온다 — 이건 정상이므로, **자기 서버가 담당하는 포트 범위만 필터링해서 봐야 한다**:
```bash
python3 verify-collections.py --admin-email "$L1_ADMIN_EMAIL" --admin-password "$L1_ADMIN_PASSWORD" \
  | awk '/8126|8127|.../'   # 자기 담당 포트 목록으로 교체
```

---

## 8. 네트워크 설정 — 가장 많이 삽질하는 구간

### 8.1 확인 순서 (반드시 이 순서로 — 거꾸로 하면 원인 특정이 어려움)

1. **로컬 프로세스 바인딩**: `sudo ss -tlnp | grep :<포트>` → `0.0.0.0:포트`인지 `127.0.0.1:포트`인지
2. **OCI Security List**: 서브넷에 붙은 Security List에 해당 포트 인바운드 규칙이 있는지
3. **OCI NSG**(있다면): VNIC에 별도 NSG가 붙어 추가 필터링을 하는지
4. **인스턴스 자체 방화벽**: `ufw`(있으면 `ufw status`) 뿐 아니라 **`iptables`도 별도로 확인할 것**

### 8.2 함정 — Oracle Ubuntu 이미지의 기본 iptables 정책

**증상**: Security List도 열려있고, ufw도 없는데(`ufw: command not found`) 외부에서 여전히 연결 타임아웃.

**원인**: Oracle의 Ubuntu 24.04 미니멀 이미지는 **ufw 없이도 커널 레벨 iptables에 기본 REJECT 정책**이 걸려 있을 수 있다:
```
Chain INPUT (policy ACCEPT)
...
4  ACCEPT  tcp  state NEW tcp dpt:22
5  REJECT  ... reject-with icmp-host-prohibited   ← 22 외 전부 여기서 막힘
```

**확인**:
```bash
sudo iptables -L INPUT -n --line-numbers
```

**수정** (REJECT 규칙보다 앞 번호로 삽입해야 함):
```bash
sudo iptables -I INPUT <REJECT규칙번호> -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT <REJECT규칙번호+1> -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent   # 재부팅시에도 유지
sudo netfilter-persistent save
```

> **사고 사례**: 이 작업을 서버1(hanlim)에서 실수로 실행할 뻔했다(SSH 세션 여러 개를 오가다 프롬프트를 안 보고 명령을 잘못된 창에 입력). 다행히 hanlim은 다른 경로로 이미 80/443이 열려 있어 무해한 중복으로 끝났지만, **다른 상황이었으면 운영 중인 서버의 방화벽 정책을 실수로 바꿀 뻔한 사고였다.** 여러 서버 세션을 동시에 열어두고 작업할 땐, 명령 실행 전 프롬프트(`ubuntu@<hostname>:~$`)를 매번 확인하는 습관이 필수.

### 8.3 필요한 포트 목록 (신규 노드 서버 기준)

| 포트 | 용도 |
|---|---|
| 22 | SSH |
| 80 | Let's Encrypt HTTP-01 challenge, HTTPS 리다이렉트 |
| 443 | nginx HTTPS (외부 진입점) |
| 8091~ (PocketBase 각 인스턴스) | **로컬 전용으로 충분** — nginx가 프록시하므로 굳이 외부에 안 열어도 됨. 단, 다른 서버에서 이 서버의 특정 L2/L3에 원격 접근해야 하면 그 포트만 **특정 소스 IP(/32)로 제한**해서 열 것 (전체 인터넷 노출 금지 — 관리자 API 노출 위험) |

---

## 9. DNS + 인증서 (Cloudflare + Let's Encrypt)

### 9.1 DNS A레코드

Cloudflare 대시보드 → 해당 도메인 → DNS → Add record
- Type: A, Name: `<확정한 서버 이름>`, IPv4: `<신규 서버 Public IP>`
- **Proxy status: DNS only(회색 구름)** — 기존 서버들과 동일하게 맞출 것 (프록시 켜면 Let's Encrypt HTTP-01 challenge가 Cloudflare를 거치게 되어 복잡해짐)

전파 확인:
```bash
nslookup <서버이름>.<도메인>
```

### 9.2 인증서 발급 (certbot)

```bash
sudo certbot --nginx -d <서버이름>.<도메인> --non-interactive --agree-tos -m <이메일>
sudo certbot certificates   # 발급 확인
```

**전제조건**: §8에서 80번 포트가 실제로 외부에서 도달 가능해야 함(HTTP-01 challenge 방식). 안 되면 certbot이 `Fetching http://.../.well-known/acme-challenge/...: Error getting validation data`로 실패한다 — 이게 나오면 인증서 문제가 아니라 네트워크 문제이니 §8로 돌아갈 것.

### 9.3 certbot이 만든 기본 설정을 기존 서버 패턴에 맞게 재구성

certbot은 기본적으로 `/etc/nginx/sites-enabled/default`에 인증서를 꽂는다. 기존 서버가 `sites-available/<서버이름>` 같은 전용 파일 구조를 쓴다면, 인증서 발급 후 그 구조에 맞게 새 설정 파일을 작성하고 `default`는 비활성화한다:

```bash
sudo rm /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/<새파일> /etc/nginx/sites-enabled/<새파일>
sudo nginx -t && sudo systemctl reload nginx
```

---

## 10. nginx 라우팅 — 노드별 프록시 경로

기존 서버의 실제 설정을 **반드시 먼저 확인**하고 동일 패턴으로 작성한다 (추측으로 새로 만들지 말 것):

```bash
sudo find /etc/nginx -iname "*<관련키워드>*"
cat /etc/nginx/sites-available/<기존파일>
```

패턴 (예시, `/n/{folder}/` 형식):
```nginx
server {
    listen 443 ssl;
    server_name <서버이름>.<도메인>;
    ssl_certificate     /etc/letsencrypt/live/<서버이름>.<도메인>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<서버이름>.<도메인>/privkey.pem;

    location /n/<노드폴더명>/ {
        rewrite ^/n/<노드폴더명>/(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:<해당노드포트>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # SSE 필수
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        # WebSocket(PocketBase Realtime) 필수
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
    }
    # ... 노드별 반복
}
server {
    listen 80;
    server_name <서버이름>.<도메인>;
    return 301 https://$host$request_uri;
}
```

각 노드마다 이 6줄(SSE 3줄 + WebSocket 3줄)을 빠짐없이 넣을 것 — 실시간 기능이 조용히 깨지는 원인이 된다.

테스트:
```bash
curl -s https://<서버이름>.<도메인>/n/<노드폴더명>/api/health
```

---

## 11. Worker(Cloudflare) 라우팅 테이블 갱신

물리 서버를 나눴다면, `worker.js`의 `L1_NODE_MAP`(또는 동등한 라우팅 테이블)에서 이관된 노드들의 URL을 반드시 갱신해야 실제 트래픽이 새 서버로 간다.

### 11.1 패치 전 원본 상수 구조 확인 (추측 금지)

```bash
grep -n "L1_BASE_HOST\|L1_NODE_MAP" worker.js | head -20
```

### 11.2 패치 예시 — 새 base host 상수를 추가하고, 이관된 노드만 교체

```javascript
const L1_BASE_HOST = 'https://<기존서버>.<도메인>';
const <신규>_L1_BASE_HOST = 'https://<신규서버>.<도메인>';   // 신설

// L1_NODE_MAP 안에서 이관된 노드만:
'<NODE_ID>': <신규>_L1_BASE_HOST + '/n/<폴더명>',   // 기존: L1_BASE_HOST + ...
```
**상위 계층(L2 등)이 여전히 원래 서버에 남아있다면 그 항목은 건드리지 말 것** — 물리적으로 옮긴 노드만 정확히 골라서 바꿔야 한다.

### 11.3 fix.py 작성 시 — 반드시 실제 파일로 사전 검증

텍스트 붙여넣기로 전달받은 코드 조각을 그대로 믿고 `OLD` 문자열을 만들면, **보이지 않는 공백/개행 하나 차이로 매칭이 실패**할 수 있다 (실제로 이번 세션에서 main.pb.js 패치 때 발생 — 두 줄 사이 빈 줄 하나 때문에 매칭 실패, 진단에 상당한 시간 소요).

**권장 절차**:
1. 서버에서 실제 파일을 로컬로 다운로드 → 채팅에 업로드
2. 업로드된 실제 파일을 직접 읽고 `str_replace`로 수정 (텍스트 재입력 없이)
3. 수정된 완전한 파일을 다시 다운로드 제공 — 이게 fix.py보다 훨씬 안전
4. fix.py 방식을 꼭 써야 한다면, 재구성한 목(mock) 파일에 대해 **먼저 테스트**하고 idempotency(재실행 시 안전)까지 확인한 뒤 전달할 것

### 11.4 배포

```powershell
$env:CLOUDFLARE_API_TOKEN = "<토큰>"
wrangler whoami   # 인증 확인 먼저
wrangler deploy
```

**주의**: `CF_API_TOKEN`(구 환경변수명)은 deprecated — 반드시 `CLOUDFLARE_API_TOKEN`을 사용할 것. 토큰 만료/권한 부족 시 `Authentication error [code: 10000]`이 뜨는데, 이 경우 Cloudflare 대시보드 → My Profile → API Tokens에서 "Edit Cloudflare Workers" 템플릿으로 재발급.

### 11.5 배포 검증 — 검증 방법 자체를 신중히 고를 것

**실수 사례**: 배포 후 검증한다며 `/biz/supply?node=<ID>` 같은 엔드포인트를 호출했는데, 정작 이 엔드포인트는 `node` 파라미터를 아예 안 쓰고 항상 기본 서버만 조회하는 구조였다. 응답이 옛 서버로 나온 걸 보고 "배포 실패"로 오인해 불필요하게 재배포·재확인을 반복했다.

**교훈**: 검증용 엔드포인트를 고르기 전에, **그 엔드포인트가 실제로 문제의 라우팅 테이블(`L1_NODE_MAP` 등)을 사용하는 코드인지 먼저 grep으로 확인**할 것:
```bash
grep -n "L1_NODE_MAP\[" worker.js
```
이 목록에 있는 함수들 중 하나를 골라 검증해야 의미가 있다. 확인 없이 "그럴듯한 이름의 엔드포인트"를 추측해서 부르지 말 것.

가장 확실한 검증은 실시간 로그 스트리밍이다:
```powershell
wrangler tail
```
이 상태에서 실제 트래픽(또는 관련 기능 호출)을 발생시켜, 로그에 신규 서버 도메인으로 나가는 fetch 호출이 찍히는지 직접 확인.

---

## 12. 패치 제출 표준 절차 (git 작업 시 사고 방지)

### 12.1 표준 순서

```powershell
Move-Item fix.py <대상폴더> -Force
cd <대상폴더>
Select-String -Path fix.py -Pattern "<패치를 식별할 수 있는 고유 문자열>"   # 실행 전 내용 확인
python fix.py
git diff --stat   # 의도한 파일만 나오는지 반드시 확인
git add <구체적 파일명>   # git add -A 금지 (아래 사고 사례 참고)
git commit -m "..."
git pull origin main --rebase
git push origin main
Remove-Item fix.py -Force   # 다음 세션 stale 재실행 사고 방지, 필수
```

### 12.2 실제 겪은 사고 두 건

**사고 A — stale fix.py 재실행**: 이전 세션에서 쓰고 지우지 않은 `fix.py`가 작업 폴더에 남아있다가, 다음 세션에서 무심코 다시 실행되어 **최근에 완성한 기능(trade_ratings 실거래 평가 시스템 170줄)을 통째로 삭제**하는 사고가 발생했다. `git commit` 직전에 `git diff --stat`으로 파일별 변경량을 확인하지 않았다면 그대로 push될 뻔했다.
→ **대응**: `git revert --no-edit <커밋해시>`로 즉시 원상복구. 재발 방지로 표준 절차에 "패치 적용 후 fix.py 즉시 삭제"를 명시적으로 추가.

**사고 B — `git add -A`가 무관한 변경사항을 같이 커밋**: 작업 폴더에 남아있던 이전 세션의 미완료 변경사항이 이번 커밋에 같이 쓸려 들어감.
→ **대응**: `git add -A` 대신 **패치 대상 파일을 명시적으로 지정**(`git add worker.js` 등). 커밋 전 `git diff --stat`으로 예상 파일만 나오는지 확인하는 걸 습관화.

### 12.3 원격에서 패치 못 찾을 때의 진단 순서

fix.py의 `OLD` 문자열이 실제 파일과 매칭 안 될 때, 아래 순서로 좁혀갈 것 (전부 스크립트 매칭보다 눈으로 직접 대조가 빠를 때가 많다):
1. `_selfFolder` 같은 흔한 변수명으로 `.find()`하면 **동일 패턴이 여러 곳에 있어 엉뚱한 위치를 잡을 수 있다** — 문맥상 고유한 앵커 문자열(예: 특정 조건문 전체)을 써야 함
2. 그래도 안 되면, 실제 파일을 다운로드받아 채팅에 업로드 → 직접 대조가 가장 빠르고 확실함 (§11.3 참고)

---

## 12.5 부록 — 사소하지만 시간을 많이 잡아먹은 문제들

### A. bash에서 `!`가 들어간 비밀번호는 히스토리 확장을 유발할 수 있다

`L1_ADMIN_PASSWORD` 값에 `!`가 포함된 걸로 잘못 알고 `export L1_ADMIN_PASSWORD="gopang2026!"`처럼 썼다가 인증이 계속 실패했다. 실제 값은 `!` 없는 `gopang2026`이었다 — 즉 이번 사례는 히스토리 확장 자체가 원인은 아니었지만, `!`가 포함된 문자열을 대화형 bash에 쌍따옴표로 넣으면 예기치 않게 씹힐 수 있다는 위험은 여전히 유효하다.

**권장 습관**:
- 비밀번호/토큰처럼 특수문자가 있을 수 있는 값은 항상 **작은따옴표**로 감쌀 것: `export VAR='값'`
- 값 자체가 의심스러우면 값을 추측하지 말고, curl로 직접 인증 테스트해서 확정할 것:
  ```bash
  curl -s -X POST <base_url>/api/admins/auth-with-password \
    -H "Content-Type: application/json" \
    -d "{\"identity\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
  ```
  `"token"` 필드가 나오면 그 값이 맞는 것 — 그 전까지는 "아마 이 값일 것"이라고 다음 단계로 넘어가지 말 것.

### B. 대량 노드를 한 번에 배포하기 전에, 소규모로 먼저 측정하는 것을 권장

이번 세션에서는 파일럿/시뮬레이션 목적이라 "속도는 무관하다"는 명시적 지시에 따라 37개를 한 번에 배포했고 결과적으로 문제는 없었다. 하지만 **운영 환경에서는 이렇게 하지 말 것을 권장한다.** 이유:

- 서버 메모리가 빠듯한 상태(1GB급)에서 다수 노드를 동시에 기동시키면 §6.2의 "응답 오탐" 현상이 생기고, 로그만으로는 진짜 실패와 오탐을 구분하기 어려워진다.
- 권장 절차: 5개 내외로 먼저 배포 → `free -h`/`swapon --show`로 여유 확인 → 문제없으면 다음 배치 진행. 매 배치 사이에 메모리 여유가 계속 줄어드는 추세라면, 배치를 더 키우기 전에 스왑 확장이나 서버 증설을 먼저 검토할 것.

### C. 여러 SSH 세션을 동시에 열어두고 작업할 때는 매 명령 전에 프롬프트를 확인할 것

두 대 이상의 서버(또는 서버+로컬 PC)를 오가며 작업하면, 직전 세션에 있던 명령을 다른 창에 잘못 붙여넣는 사고가 나기 쉽다(§8.2 사고 사례). 특히 `sudo`가 들어간 방화벽/시스템 설정 명령은 실행 직전 프롬프트(`ubuntu@<hostname>:~$`)를 한 번 더 확인하는 습관이 필요하다.

### D. 배포 후 "검증"이라는 이름의 무한 루프에 빠지지 않도록

한 가지 검증 방법이 기대와 다른 결과를 내면, 그 결과를 "배포 실패"로 단정하기 전에 **검증 방법 자체가 맞는지부터 의심할 것**(§11.5). 실제로 이번 세션에서 이미 정상 배포된 상태를 두고, 존재하지도 않는 엔드포인트와 파라미터를 안 쓰는 엔드포인트를 연달아 잘못 짚어가며 불필요한 재배포·재확인을 3회 반복했다. 검증 방법을 바꾸기 전에 `grep`으로 "이 엔드포인트가 실제로 내가 바꾼 코드를 쓰는가"부터 확인하는 게 먼저다.

---

## 13. 최종 체크리스트 (신규 도시 노드 구축 시)

- [ ] 기존 서버 shape/region 실측 확인 (추측 금지)
- [ ] A1.Flex 무료 이전 가능 여부 3단계 확인 (리전 제약 → 리전 구독 → 한도)
- [ ] 물리 서버 명명 규칙 사전 확정 (계층명 오해 방지)
- [ ] OCI CLI 인증 설정 + 연결 테스트
- [ ] 신규 인스턴스 생성 (기존과 동일 AD/이미지/서브넷/SSH키)
- [ ] 스왑 설정 (최소 2GB)
- [ ] 필수 패키지 + PocketBase 바이너리(버전 일치) 설치
- [ ] 파일 이관 (로컬 PC 경유) — 전송 후 매번 `ls -la`로 확인
- [ ] provision-l1-nodes.py 최신 패치본 사용 (chown 수정 + 오탐 방지 포함)
- [ ] dry-run 먼저, 실제 실행은 `sudo -E`
- [ ] verify-collections.py로 로그가 아닌 실제 상태 확인
- [ ] 상위 계층(L2/L3) 등록은 그 노드가 있는 서버에서 로컬로 실행
- [ ] 네트워크 확인 순서: 로컬 바인딩 → Security List → NSG → **iptables**(ufw 없어도 존재 가능)
- [ ] DNS(DNS only 모드) → 인증서(80 포트 전제조건 확인) → nginx 전용 설정 파일 재구성
- [ ] SSE/WebSocket 헤더 6줄 노드마다 누락 없이 포함
- [ ] Worker `L1_NODE_MAP` 갱신 — fix.py는 실제 파일로 사전 검증 후 작성
- [ ] `CLOUDFLARE_API_TOKEN`(구 `CF_API_TOKEN` 아님) 유효성 확인 후 배포
- [ ] 배포 검증 엔드포인트는 실제로 해당 라우팅 테이블을 쓰는지 grep으로 먼저 확인
- [ ] fix.py 사용 후 즉시 삭제, `git add`는 파일 명시, `git diff --stat`으로 매 커밋 전 확인
- [ ] 관리자 비밀번호 등 민감값은 작은따옴표로 감싸고, 추측 대신 curl로 직접 인증 확인
- [ ] 운영 환경이라면 대량 배포를 소규모 배치(5개 내외)로 나눠 메모리 추이를 보며 진행
- [ ] 여러 서버 세션을 동시에 열어둔 경우, sudo 명령 실행 전 프롬프트로 대상 서버 재확인
