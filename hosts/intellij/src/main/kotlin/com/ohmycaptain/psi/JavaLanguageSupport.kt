package com.ohmycaptain.psi

import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.ohmycaptain.logging.loggerFor

/**
 * Java PSI 기반 [LanguageSupport].
 *
 * `com.intellij.java` 번들 플러그인이 활성화된 환경에서만 동작한다 — IntelliJ Community/Ultimate 는 OK,
 * WebStorm/GoLand 등 비-Java IDE 에서는 [isAvailable] 이 false 를 돌려준다.
 */
internal class JavaLanguageSupport : LanguageSupport {

    private val log = loggerFor<JavaLanguageSupport>()

    override val id: String = "java"

    private val available: Boolean by lazy {
        try {
            Class.forName("com.intellij.psi.PsiClass")
            true
        } catch (_: ClassNotFoundException) {
            false
        }
    }

    override fun isAvailable(): Boolean = available

    override fun extractSymbol(element: PsiElement, line: Int): SymbolDto? {
        return try {
            when (element) {
                is com.intellij.psi.PsiClass  -> SymbolDto("class", element.name ?: "", line)
                is com.intellij.psi.PsiMethod -> SymbolDto("function", element.name, line)
                is com.intellij.psi.PsiField  -> SymbolDto("variable", element.name, line)
                else -> null
            }
        } catch (e: NoClassDefFoundError) {
            // 가용성 플래그를 통과한 후에도 클래스 로딩이 깨지는 매우 드문 환경 이슈. 디버그 가치 있음.
            log.debug(e) { "[OMC] Java PSI symbol 추출 실패 — NoClassDefFoundError 안전망" }
            null
        }
    }

    override fun extractImports(psiFile: PsiFile): List<String>? {
        return try {
            if (psiFile is com.intellij.psi.PsiJavaFile) {
                psiFile.importList?.importStatements
                    ?.map { it.qualifiedName ?: "" }
                    ?.filter { it.isNotEmpty() }
                    ?: emptyList()
            } else null  // Java PSI 가 처리할 파일이 아님 → collector 가 fallback 시도
        } catch (e: NoClassDefFoundError) {
            log.debug(e) { "[OMC] Java PSI import 추출 실패 — NoClassDefFoundError 안전망" }
            null
        }
    }
}
