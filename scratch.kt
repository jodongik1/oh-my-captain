import org.cef.handler.CefDisplayHandlerAdapter
import org.cef.browser.CefBrowser
import org.cef.CefSettings.LogSeverity

class Test : CefDisplayHandlerAdapter() {
    override fun onConsoleMessage(browser: CefBrowser, level: LogSeverity, message: String, source: String, line: Int): Boolean {
        return false
    }
}
