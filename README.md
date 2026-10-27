# Sites 정적 사이트 게시 보조 도구

이 도구는 이 작업 공간에서 만든 비공식 대체 도구다. Sites 서비스나 공식 플러그인의 일부가 아니다. Sites의 `get_site`, 원본 저장소 자격증명 발급, 버전 저장 및 배포 도구는 별도로 필요하다. HTML·이미지 등 **정적 출력**을 대상으로 하며 Worker, 서버 앱, D1/R2, 빌드 실행은 지원하지 않는다. 빌드는 별도로 마치고 사이트의 `.openai/hosting.json`에 정확한 `project_id`와 지원되는 `static.directory`를 지정한다.

## 다른 Cloud 환경에서 사용

이 저장소를 Cloud 환경에 연결하거나 복제한 뒤, 게시 작업에서 저장소의 `README.md`를 읽고 따라야 한다. 프로젝트마다 작업 공간은 분리되어 있으므로 다른 프로젝트에 자동으로 파일이나 지침이 전달되지는 않는다. 설치 시 사이트의 원본 저장소와 이 도구 저장소를 구별한다.

## 에이전트 사용 절차

1. 게시 대상 사이트의 ID와 권한, 현재 공유 범위를 Sites의 `get_site`로 확인한다. 새 사이트라면 Sites 도구로 생성하고 반환된 ID를 원본의 `.openai/hosting.json`에 기록한다. 기존 사이트는 ID와 공유 범위를 보존한다.
2. Sites의 `create_source_repository_write_credential`에서 받은 자격증명을 세션 메모리에만 보관한다. 저장소 루트에서 `node site-workflow.mjs`를 입력 에코를 끈 PTY로 실행하고, 다음 형식의 JSON 한 줄을 stdin으로 보낸다. 토큰을 터미널 명령, 파일, 로그, 최종 답변에 넣지 않는다.

   `{"mode":"inspect","project_id":"<사이트 ID>","credential":{...}}`

3. 반환된 `remote_head`를 확인한다. 기존 사이트라면 원본과 원격 커밋을 비교해 게시할 변경을 검토하고, 그 커밋을 `expected_head`로 사용한다. 새 빈 저장소는 `null`이다. 충돌 또는 예상 밖의 변경이 있으면 중단하고 확인한다.
4. 같은 방법으로 새 자격증명 또는 유효한 기존 자격증명을 stdin으로 전달한다. 예: `{"mode":"publish","project_id":"<사이트 ID>","credential":{...},"source_dir":"/workspace/프로젝트","source_paths":["index.html","assets"],"expected_head":"<확인된 SHA 또는 null>","archive_path":"/workspace/scratch/site-deploy.tar.gz"}`. `source_paths`는 버전 관리할 **추가** 원본만 지정한다. `.openai/hosting.json`과 `static.directory`는 자동 포함된다. 항목은 실제 존재해야 하며 출력 디렉터리와 중첩될 수 없다. `.env`, `node_modules`, `.git`, 심볼릭 링크는 허용하지 않는다. 아카이브는 프로젝트 바깥에 둔다.
5. 결과의 `commit_sha`, `archive`, `project_id`를 Sites 저장·배포 도구에 그대로 전달한다. 소유자 전용이면 `save_version_and_deploy_private`, 그 외에는 현재 접근 범위에 맞는 저장·배포 도구를 사용한다. 배포가 완료될 때까지 상태를 확인하고 성공 URL을 보고한다. 도구 자체는 배포하지 않는다.

이 도구는 원격이 예상 커밋에서 바뀌면 중단하며 강제 푸시하지 않는다. 기존 원격 저장소의 지정하지 않은 파일은 보존하지만, 지정된 디렉터리는 로컬 버전으로 교체하므로 해당 디렉터리의 삭제도 반영된다. Git 추적 소스에 출력 디렉터리를 포함하고 동일 커밋에서 배포 아카이브를 만든다. 자격증명은 프로세스 메모리에서만 처리하며 깃 설정 파일에 저장하지 않는다.

## 점검

`node tests/integration.mjs`

임시 로컬 Git 저장소를 사용해 빈 저장소 게시, 자산 아카이브, 오래된 커밋 거부, 기존 사이트 수정을 점검한다. 실제 Sites 연결과 배포 API는 테스트하지 않는다. 테스트는 Node.js, Git, Python 3, tar 및 POSIX 환경이 필요하다. 각 Cloud 프로젝트에서 이 저장소를 별도로 연결하거나 복제해야 하며 자동으로 설치되지는 않는다.
