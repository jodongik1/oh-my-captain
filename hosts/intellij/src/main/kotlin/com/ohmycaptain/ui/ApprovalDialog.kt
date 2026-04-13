package com.ohmycaptain.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBLabel
import javax.swing.*

class ApprovalDialog(
    project: Project,
    private val action: String,
    private val description: String,
    private val risk: String
) : DialogWrapper(project) {
    init {
        title = "Oh My Captain — 승인 요청"
        init()
    }

    override fun createCenterPanel(): JComponent {
        val riskColor = when (risk) {
            "high"   -> "#f48771"
            "medium" -> "#cca700"
            else     -> "#4ec994"
        }
        return JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            add(JBLabel("<html><b>작업:</b> $action</html>"))
            add(Box.createVerticalStrut(8))
            add(JBLabel("<html>$description</html>"))
            add(Box.createVerticalStrut(8))
            add(JBLabel("<html><b>위험도:</b> <span style='color:$riskColor'>$risk</span></html>"))
        }
    }
}
