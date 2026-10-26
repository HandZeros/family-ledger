package com.handzeros.familyledger;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * 1.1 起账本界面直接跑在 App 自己的 WebView 里（构建时由 tools/build-mobile.js
 * 把 Web 端打进 assets），不再跳系统浏览器。因此返回键要先交给页面处理：
 * 关闭弹层 → 回到首页 → 都不需要了才把 App 退到后台。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 在 super.onCreate 之后注册，回调顺序上优先于 Capacitor 内置的返回处理
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge bridge = getBridge();
                WebView webView = bridge == null ? null : bridge.getWebView();
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                        "(window.__flHandleBack ? window.__flHandleBack() : 'exit')",
                        value -> {
                            // 页面返回 handled 表示已自行处理（关弹层 / 回首页）
                            if (value == null || value.contains("exit")) {
                                moveTaskToBack(true);
                            }
                        });
            }
        });
    }
}
