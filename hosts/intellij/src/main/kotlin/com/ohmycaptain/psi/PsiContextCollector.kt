package com.ohmycaptain.psi

import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.*
import com.intellij.psi.util.PsiTreeUtil

data class SymbolDto(val kind: String, val name: String, val line: Int)
data class DiagnosticDto(val severity: String, val message: String, val line: Int)
data class FileContextDto(
    val path: String,
    val language: String = "unknown",
    val content: String = "",
    val symbols: List<SymbolDto> = emptyList(),
    val imports: List<String> = emptyList(),
    val diagnostics: List<DiagnosticDto> = emptyList()
)

class PsiContextCollector {

    // Java PSI 클래스가 런타임에 존재하는지 확인 (com.intellij.java 번들 플러그인 유무)
    private val javaPsiAvailable: Boolean by lazy {
        try {
            Class.forName("com.intellij.psi.PsiClass")
            true
        } catch (_: ClassNotFoundException) {
            false
        }
    }

    // Kotlin PSI 가 존재하는지 확인 (org.jetbrains.kotlin 번들 플러그인 유무)
    private val kotlinPsiAvailable: Boolean by lazy {
        try {
            Class.forName("org.jetbrains.kotlin.psi.KtClassOrObject")
            true
        } catch (_: ClassNotFoundException) {
            false
        }
    }

    fun collect(project: Project, file: VirtualFile): FileContextDto {
        return ReadAction.compute<FileContextDto, Exception> {
            val psiFile = PsiManager.getInstance(project).findFile(file)
                ?: return@compute FileContextDto(
                    path = file.path,
                    content = String(file.contentsToByteArray(), Charsets.UTF_8)
                )

            FileContextDto(
                path = file.path,
                language = file.fileType.name,
                content = psiFile.text,
                symbols = collectSymbols(psiFile),
                imports = collectImports(psiFile),
                diagnostics = collectDiagnostics(project, file)
            )
        }
    }

    private fun collectSymbols(psiFile: PsiFile): List<SymbolDto> {
        val result = mutableListOf<SymbolDto>()
        psiFile.accept(object : PsiRecursiveElementVisitor() {
            override fun visitElement(element: PsiElement) {
                val doc = PsiDocumentManager.getInstance(psiFile.project)
                    .getDocument(psiFile)
                val line = doc?.getLineNumber(element.textOffset)?.plus(1) ?: 0

                // Java PSI (com.intellij.java 가 있을 때만)
                if (javaPsiAvailable) {
                    collectJavaSymbol(element, line, result)
                }

                // Kotlin PSI (org.jetbrains.kotlin 이 있을 때만)
                if (kotlinPsiAvailable) {
                    collectKotlinSymbol(element, line, result)
                }

                super.visitElement(element)
            }
        })
        return result
    }

    /** Java PSI 심볼 수집 — 별도 메서드로 분리하여 ClassNotFoundException 격리 */
    private fun collectJavaSymbol(element: PsiElement, line: Int, result: MutableList<SymbolDto>) {
        try {
            when (element) {
                is com.intellij.psi.PsiClass  -> result.add(SymbolDto("class", element.name ?: "", line))
                is com.intellij.psi.PsiMethod -> result.add(SymbolDto("function", element.name, line))
                is com.intellij.psi.PsiField  -> result.add(SymbolDto("variable", element.name, line))
            }
        } catch (_: NoClassDefFoundError) {
            // Java PSI 클래스를 로드할 수 없음 — 무시
        }
    }

    /** Kotlin PSI 심볼 수집 — 별도 메서드로 분리하여 ClassNotFoundException 격리 */
    private fun collectKotlinSymbol(element: PsiElement, line: Int, result: MutableList<SymbolDto>) {
        try {
            when (element) {
                is org.jetbrains.kotlin.psi.KtClassOrObject -> result.add(SymbolDto("class", element.name ?: "", line))
                is org.jetbrains.kotlin.psi.KtNamedFunction -> result.add(SymbolDto("function", element.name ?: "", line))
                is org.jetbrains.kotlin.psi.KtProperty       -> result.add(SymbolDto("variable", element.name ?: "", line))
            }
        } catch (_: NoClassDefFoundError) {
            // Kotlin PSI 클래스를 로드할 수 없음 — 무시
        }
    }

    private fun collectImports(psiFile: PsiFile): List<String> {
        // PsiJavaFile 도 Java PSI 에 속하므로 안전하게 처리
        if (javaPsiAvailable) {
            try {
                if (psiFile is com.intellij.psi.PsiJavaFile) {
                    return psiFile.importList?.importStatements
                        ?.map { it.qualifiedName ?: "" }?.filter { it.isNotEmpty() } ?: emptyList()
                }
            } catch (_: NoClassDefFoundError) {
                // 무시하고 fallback
            }
        }

        // Fallback: 텍스트 기반 import 추출
        return PsiTreeUtil.findChildrenOfType(psiFile, PsiElement::class.java)
            .filter { it.text.startsWith("import ") }
            .map { it.text.removePrefix("import ").trim().trimEnd(';') }
            .take(50)
    }

    private fun collectDiagnostics(project: Project, file: VirtualFile): List<DiagnosticDto> {
        // Phase 1에서는 빈 목록으로 시작, Phase 2에서 구체화
        return emptyList()
    }
}
