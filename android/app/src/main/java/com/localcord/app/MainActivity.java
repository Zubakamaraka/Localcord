package com.localcord.app;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalCordPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings s = getBridge().getWebView().getSettings();
            // голос собеседников должен звучать без отдельного нажатия
            s.setMediaPlaybackRequiresUserGesture(false);
        }
    }
}
