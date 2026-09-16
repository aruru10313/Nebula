# Nebula 프로젝트 운영·개발 가이드

이 문서는 Nebula 런처와 `mc.aruru.kr` 웹사이트를 운영·개발할 때 필요한 시스템 구성, 주요 경로, 빌드 방법, 배포 방법, 현재 상태를 한 곳에 정리한 문서입니다.

> 보안 주의: SSH 개인키 내용과 토큰은 이 문서에 기록하지 않습니다. 키 파일은 로컬에서만 사용하고 Git, 스크린샷, 공용 문서에 올리지 마세요.

## 1. 프로젝트 개요

- 프로젝트명: **Nebula Launcher**
- 원본: `dscalzi/HeliosLauncher` 기반 커스텀 런처
- 저장소: <https://github.com/aruru10313/Nebula>
- 웹사이트: <https://mc.aruru.kr/>
- Minecraft: `1.20.1`
- Forge: `47.4.23`
- 게임 서버: `comet.aruru.kr:25565`
- 현재 소스 버전: `2.0.12`
- 최신 릴리스: `v2.0.12`
- 로컬 설치본: `/home/aruru/Applications/Nebula.AppImage`

Nebula는 Microsoft 계정 로그인을 유지하고, Mojang 비밀번호 로그인은 사용하지 않습니다. 서버 필수 모드, Forge 라이브러리, Java, 개인 모드, 런처 업데이트를 관리합니다.

## 2. 로컬 경로

현재 작업 디렉터리:

```text
/home/aruru/comet-현실경제 서버/
```

Nebula 저장소:

```text
/home/aruru/comet-현실경제 서버/Nebula/
```

주요 로컬 파일:

| 경로 | 용도 |
| --- | --- |
| `index.js` | Electron 메인 프로세스, 창 생성, IPC, 자동 업데이트 |
| `package.json` | 버전, 의존성, 실행·빌드 스크립트 |
| `electron-builder.yml` | Windows/macOS/Linux 패키징 및 GitHub Publisher 설정 |
| `app/app.ejs` | 런처 전체 HTML 진입점 |
| `app/landing.ejs` | 메인 화면 |
| `app/settings.ejs` | 계정·Minecraft·모드·Java·Storage·업데이트 설정 화면 |
| `app/assets/css/launcher.css` | 런처 전체 스타일 |
| `app/assets/js/scripts/landing.js` | 메인 화면, 서버 상태, 실행, 뉴스 |
| `app/assets/js/scripts/settings.js` | 설정 탭, 모드, Storage, 업데이트 |
| `app/assets/js/scripts/uibinder.js` | 화면 전환과 초기 UI 연결 |
| `app/assets/js/processbuilder.js` | Java/Minecraft 실행 인자 생성 |
| `app/assets/js/distromanager.js` | distribution URL 및 서버 버전 검증 |
| `app/assets/js/configmanager.js` | 사용자 설정과 런처 데이터 경로 |
| `app/assets/js/useroptionmods.js` | Minecraft 버전별 개인 모드 관리 |
| `app/assets/js/modrinthapi.js` | Modrinth 검색·설치·업데이트 |
| `app/assets/js/distributioncleanup.js` | Storage 스캔 및 미사용 파일 정리 |
| `app/assets/js/reliablerepair.js` | 다운로드 재시도·검증·원자적 파일 교체 |
| `app/assets/js/serverlist.js` | `servers.dat` 자동 서버 등록 |
| `tools/generate-distribution.js` | 로컬 모드·Forge·라이브러리로 배포 파일 생성 |
| `distribution/` | 생성되는 배포 파일. Git에는 기본적으로 추적하지 않음 |
| `news-service/` | 공지 API 및 관리자 서비스 |
| `site/` | `mc.aruru.kr` 공개 웹사이트 |
| `NOTICE.md` | HeliosLauncher 기반 변경 사항과 출처 |
| `LICENSE.txt` | 원본 MIT 라이선스 |

## 3. 런처 기능 구성

### 로그인

- Microsoft OAuth 로그인
- 여러 Microsoft 계정 추가 및 선택
- 계정 로그아웃
- Mojang 비밀번호 로그인 미노출
- Azure Client ID는 `app/assets/js/ipcconstants.js`에 정의

현재 구조는 기존 HeliosLauncher 호환성을 위해 Electron renderer에서 Node/Electron API를 직접 사용하는 부분이 있습니다. `nodeIntegration: true`, `contextIsolation: false`, `@electron/remote`를 단계적으로 제거하는 것은 별도 보안 마이그레이션 작업으로 남아 있습니다.

### 배포 및 모드

- 원격 distribution:

```text
https://mc.aruru.kr/nebula/distribution.json
```

- 서버 필수 모드와 Forge 라이브러리는 distribution manifest를 기준으로 다운로드
- 파일 무결성은 현재 checksum 검증 방식
- 손상·누락 파일은 `ReliableRepair`가 재시도 후 교체
- 개인 모드는 서버 필수 모드와 분리

개인 모드 기본 경로:

```text
<런처 데이터 경로>/user-option-mods/<minecraft-version>/forge/mods
<런처 데이터 경로>/user-option-mods/<minecraft-version>/forge/manifest.json
```

### 서버 자동 등록

게임 실행 전 `servers.dat`를 검사해 다음 서버를 등록합니다.

```text
표시 이름: Nebula Survival
주소: comet.aruru.kr:25565
```

중복 등록은 방지하며, 사용자가 삭제한 서버를 매번 되살리지 않도록 marker 정책을 사용합니다.

### 뉴스

런처 뉴스 API:

```text
https://mc.aruru.kr/api/v1/news?limit=20
```

- HTTPS `mc.aruru.kr` 이미지 제한
- 허용 HTML 태그·속성 화이트리스트 적용
- API 타임아웃 10초
- 첫 요청 실패 시 350ms 후 한 번 재시도
- 실패 시 RSS가 아닌 명시적인 오류·재시도 화면 표시

### 자동 업데이트

- `electron-updater` 사용
- GitHub Releases Publisher 사용
- GitHub 저장소: `aruru10313/Nebula`
- Linux 업데이트 매니페스트: `latest-linux.yml`
- macOS 업데이트 매니페스트: `latest-mac.yml`
- Windows 업데이트 매니페스트: `latest.yml`

## 4. 사용자 데이터 경로

Electron `app.getPath('userData')` 기준 런처 설정 경로는 보통 다음과 같습니다.

```text
~/.config/Nebula Launcher/
```

운영체제별 기본 경로:

| OS | 기본 런처 데이터 경로 |
| --- | --- |
| Linux | `~/.config/Nebula Launcher/` |
| Windows | `%APPDATA%/Nebula Launcher/` |
| macOS | `~/Library/Application Support/Nebula Launcher/` |

주요 데이터:

```text
config.json
distribution.json
user-option-mods/
```

현재 계정 토큰은 기존 HeliosLauncher 방식에 따라 `config.json`에 저장됩니다. OS 자격 증명 저장소(Keychain, Credential Manager, Secret Service)로 이전하는 작업은 아직 남아 있습니다. `config.json`을 다른 사람에게 공유하지 마세요.

## 5. 배포 서버

### 공개 도메인

```text
mc.aruru.kr
```

### 현재 확인된 Oracle 서버

```text
공인 IP: 158.180.92.51
사용자: ubuntu
```

`158.180.92.91`은 제공된 키로 인증되지 않았고, DNS 확인 결과 실제 웹 서버는 `.51`이었습니다.

### SSH 키 위치

키 압축파일:

```text
/home/aruru/다운로드/ssh-20260820T154926Z-1-001.zip
```

압축 해제된 임시 키:

```text
/tmp/nebula-aruru.key
```

키는 반드시 권한 `600`으로 유지합니다.

예시 접속:

```bash
ssh -i /tmp/nebula-aruru.key ubuntu@158.180.92.51
```

### 원격 웹 경로

```text
/var/www/nebula-current/html/
```

주요 배포 위치:

```text
/var/www/nebula-current/html/index.html
/var/www/nebula-current/html/styles.css
/var/www/nebula-current/html/site.js
/var/www/nebula-current/html/nebula/distribution.json
/var/www/nebula-current/html/nebula/
```

Nginx 활성 설정:

```text
/etc/nginx/sites-enabled/mc
```

웹 백업 예시:

```text
/var/backups/nebula/web-20260916-135340.tgz
```

백업 SHA-256:

```text
468943b4e80316a8361b1caebf0e2c7830fccc50de30fc4792900f93fea27355
```

## 6. 개발·실행 명령

의존성 설치:

```bash
cd "/home/aruru/comet-현실경제 서버/Nebula"
npm install
```

개발 실행:

```bash
npm start
```

Linux 로컬 빌드:

```bash
npm run dist:linux
```

Windows/macOS 빌드:

```bash
npm run dist:win
npm run dist:mac
```

배포 파일 생성:

```bash
NEBULA_ASSET_BASE_URL=https://mc.aruru.kr/nebula \
NEBULA_SERVER_ADDRESS=comet.aruru.kr:25565 \
npm run generate:distribution
```

생성 결과는 `distribution/`에 저장됩니다. 이 디렉터리는 크기가 크고 `.gitignore` 대상이므로, 별도로 웹 서버에 업로드해야 합니다.

문법 확인:

```bash
node --check index.js
node --check app/assets/js/scripts/settings.js
node --check app/assets/js/scripts/landing.js
node --check site/site.js
```

## 7. 릴리스 절차

1. `package.json`과 `package-lock.json` 버전을 올립니다.
2. 로컬 Linux 빌드 및 실행 확인을 합니다.
3. 변경 파일을 커밋합니다.
4. 버전 태그를 만듭니다.
5. `master`와 태그를 GitHub에 push합니다.
6. GitHub Actions의 Windows/macOS/Linux 빌드를 확인합니다.
7. GitHub Release assets에 설치 파일과 updater manifest가 있는지 확인합니다.
8. 필요하면 `/home/aruru/Applications/Nebula.AppImage`를 새 AppImage로 교체합니다.

예시:

```bash
npm version 2.0.13 --no-git-tag-version
npm run dist:linux
git add .
git commit -m "release: Nebula 2.0.13"
git tag v2.0.13
git push origin master
git push origin v2.0.13
```

현재 릴리스:

```text
v2.0.12
커밋: 2e97905
```

v2.0.12에는 다음 파일이 포함되어 있습니다.

```text
Nebula-setup-2.0.12.AppImage
Nebula-setup-2.0.12.deb
Nebula-setup-2.0.12.exe
Nebula-Launcher-setup-2.0.12-x64.dmg
Nebula-Launcher-setup-2.0.12-arm64.dmg
latest-linux.yml
latest.yml
latest-mac.yml
```

## 8. 최근 주요 변경 이력

| 커밋 | 내용 |
| --- | --- |
| `68bcb86` | Minecraft 버전별 개인 모드 경로 분리 |
| `0a2ee4d` | Nebula 웹사이트 전면 개편 |
| `bd483e8` | 런처 Nebula 디자인 시스템 개편 |
| `fe10be7` | 런처 2.0.7 릴리스 |
| `d28d530` | GPU 가속 복구 및 Linux Vulkan 우회 |
| `55f3773` | 뉴스 오버레이가 시작 화면을 덮던 문제 수정 |
| `f6c5195` | 설정 레이아웃·Storage 스캔·성능 개선 |
| `2e97905` | 릴리스 노트 XSS 차단 및 상태/웹 폴백 개선 |

## 9. 현재 보안 상태와 남은 작업

완료:

- 뉴스 HTML 화이트리스트 새니타이저
- 뉴스 이미지 호스트·MIME·크기 제한
- 공지 관리자 인증·TOTP·CSRF·rate limit·Helmet
- 업로드 파일 signature 확인
- 릴리스 노트 외부 HTML 실행 차단
- 서버 모드 checksum 검증
- 다운로드 재시도·timeout·임시파일·원자적 이동
- 웹사이트 HTTPS 및 보안 헤더 구성

남은 작업:

1. `nodeIntegration: true`를 제거하고 `contextIsolation: true` + preload `contextBridge`로 IPC 이전
2. `@electron/remote` 제거
3. Microsoft 토큰을 OS 자격 증명 저장소로 이전
4. distribution manifest 및 모드 파일에 서명 검증 추가
5. `launcher.css` 중복 선택자 통합 및 디자인 토큰 정리
6. 운영 공지에 테스트 콘텐츠가 올라가지 않도록 staging/production 분리
7. 서버 상태 조회에 재시도·오프라인·복구 상태를 더 명확히 표시
8. 실제 수신 가능한 문의 이메일 주소 확정

## 10. 현재 작업 트리 주의사항

다음 파일은 현재 Git에 추적되지 않는 기존 파일입니다. 임의로 삭제하거나 커밋하지 마세요.

```text
_custom.toml
app.ejs
forge-1.20.1-47.4.23-installer.jar.log
```

이 문서는 비밀키, OAuth 토큰, 관리자 비밀번호, TOTP secret을 포함하지 않습니다.

