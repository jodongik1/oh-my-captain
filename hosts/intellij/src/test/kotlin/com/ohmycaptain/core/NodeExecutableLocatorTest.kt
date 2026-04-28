package com.ohmycaptain.core

import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS

/**
 * [NodeExecutableLocator] 의 통합 테스트.
 *
 * 시스템에 실제 설치된 Node 를 탐색하므로 환경 의존적이지만, 개발자 머신에서 빌드가 통과한다는 것은
 * Node 가 설치되어 있다는 가정을 깔 수 있다. CI 에서는 별도 Node 설정이 필요할 수 있어 OS 가드만 둔다.
 */
class NodeExecutableLocatorTest {

    @Test
    @DisabledOnOs(OS.WINDOWS)  // 윈도우 환경 가용성 보장 어려움 — 별도 검증 필요 시 추가
    fun `find 는 nvm 또는 PATH 의 node 를 찾아낸다`() {
        val path = NodeExecutableLocator.find()

        // dev 환경에서는 nvm/fnm/PATH 중 하나에 반드시 존재해야 한다 (Core 부팅 전제 조건).
        assertNotNull(path, "Node 를 찾지 못함 — 개발 환경 점검 필요")
        assertTrue(path!!.endsWith("node"), "node 실행 파일 경로여야 함: $path")
    }
}
