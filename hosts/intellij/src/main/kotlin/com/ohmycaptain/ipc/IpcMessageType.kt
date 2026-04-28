package com.ohmycaptain.ipc

/**
 * IPC 메시지 타입 상수.
 *
 * Core(Node.js) ↔ Kotlin 사이 envelope 의 `type` 필드에 사용되는 식별자를 한 곳에서 관리한다.
 * Core 측 코드는 별도 패키지에 동일 이름의 상수를 갖고 있어야 하며, 양쪽이 어긋나면 메시지가 silent drop 된다.
 *
 * 도입 이유:
 * - 문자열 리터럴이 여러 곳에 흩어져 있던 구조에서 오타 한 글자가 런타임 무응답을 유발했음.
 * - object 상수로 모으면 IDE 의 "Find Usages" 로 영향 범위를 즉시 파악 가능.
 * - 호환을 깨뜨리지 않기 위해 단순 String 상수만 모은 객체로 유지 (sealed class 는 envelope 직렬화까지 영향이 커서 보류).
 */
object IpcMessageType {

    // ── Webview → Core (또는 Kotlin → Core) ──────────────────────────────
    /** Core 부팅 직후 핸드셰이크. 프로젝트 루트·모드를 전달. */
    const val INIT = "init"
    /** 우클릭 메뉴 또는 슬래시 명령으로 발사하는 코드 액션. */
    const val CODE_ACTION = "code_action"
    /** Core 의 도구 실행 승인 요청에 대한 사용자 응답. */
    const val APPROVAL_RESPONSE = "approval_response"
    /** Core 의 PSI 컨텍스트 요청에 대한 IDE 측 응답. */
    const val CONTEXT_RESPONSE = "context_response"

    // ── Core → Kotlin (또는 Kotlin → Webview) ────────────────────────────
    /** Core 가 PSI 정보(심볼·import·진단)를 요청. */
    const val CONTEXT_REQUEST = "context_request"
    /** Core 가 도구 실행 전 사용자 승인을 요청. */
    const val APPROVAL_REQUEST = "approval_request"
    /** Core 가 IDE 측 액션 호출을 트리거 (Webview 슬래시 명령 라우팅용). */
    const val INVOKE_ACTION = "invoke_action"

    // ── 양방향 ───────────────────────────────────────────────────────────
    /** 특정 파일/라인을 IDE 에디터에서 열라는 요청. Core·Webview 양쪽에서 발사 가능. */
    const val OPEN_IN_EDITOR = "open_in_editor"
    /** 도구 실행 결과(긴 텍스트) 를 IDE 가상 파일 탭으로 띄우라는 요청. */
    const val OPEN_TOOL_OUTPUT = "open_tool_output"

    // ── Kotlin → Webview 전용 ────────────────────────────────────────────
    /** Webview 가 부팅을 알린 직후 Core 준비 사실을 통보. */
    const val CORE_READY = "core_ready"
    /** Webview 가 부팅 완료를 알리는 신호. */
    const val READY = "ready"
    /** 사용자에게 표시할 비치명적 에러. */
    const val ERROR = "error"
}
