package com.ohmycaptain.psi

import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile

/**
 * 언어별 PSI 분석 전략.
 *
 * Java/Kotlin/Python/JS 등 새 언어를 추가할 때 [PsiContextCollector] 본체에 손을 대지 않고
 * 새 구현체만 [LanguageSupportRegistry] 에 추가하면 된다 — OCP 준수.
 *
 * 가용성 검사: 각 구현체는 PSI 클래스(`com.intellij.psi.PsiClass` 등)가 런타임에 로드 가능한지
 * 직접 검사한다. JetBrains 번들 플러그인이 비활성화된 환경(Community 같은 일부 IDE)에서도
 * NoClassDefFoundError 가 collector 전체를 깨뜨리지 않게 한다.
 */
internal interface LanguageSupport {
    /** 사람이 읽기 위한 식별자 (예: "java", "kotlin"). 로그·디버깅용. */
    val id: String

    /** 런타임에 이 언어 PSI 가 사용 가능한지. 가용하지 않으면 [extractSymbol]/[extractImports] 가 호출되지 않는다. */
    fun isAvailable(): Boolean

    /**
     * 단일 PSI 요소가 이 언어의 심볼이면 [SymbolDto] 로 변환, 아니면 null.
     * 트리 순회는 [PsiContextCollector] 가 책임지므로 이 메서드는 한 요소만 본다.
     */
    fun extractSymbol(element: PsiElement, line: Int): SymbolDto?

    /**
     * 파일 단위 import 목록 추출. 이 언어가 처리할 수 없는 파일이면 null 반환 — collector 가 fallback 사용.
     */
    fun extractImports(psiFile: PsiFile): List<String>?
}

/**
 * 언어 전략 레지스트리.
 *
 * 새 언어 추가 절차:
 * 1. [LanguageSupport] 구현체 작성 (예: PythonSupport)
 * 2. [defaultLanguageSupports] 리스트에 추가
 * 3. PSI 분석에 필요한 의존성을 build.gradle 의 plugins 블록에 추가
 *
 * 테스트에서는 가짜 [LanguageSupport] 리스트를 주입할 수 있도록 [PsiContextCollector] 가
 * 생성자에서 받는다.
 */
internal fun defaultLanguageSupports(): List<LanguageSupport> = listOf(
    JavaLanguageSupport(),
    KotlinLanguageSupport(),
)
