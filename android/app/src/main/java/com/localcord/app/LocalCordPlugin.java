package com.localcord.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Нативные возможности LocalCord на Android:
 * автопоиск серверов (UDP), открытие ссылок и загрузок, работа голоса в фоне.
 */
@CapacitorPlugin(name = "LocalCord")
public class LocalCordPlugin extends Plugin {

    private static final int DISCOVERY_PORT = 41234;
    private static final String MAGIC_Q = "LOCALCORD_DISCOVER_V1";
    private static final String MAGIC_A = "LOCALCORD_HERE_V1";

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        String version = "0.0.0";
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            version = pi.versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        ret.put("version", version);
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        call.resolve(ret);
    }

    @PluginMethod
    public void discover(final PluginCall call) {
        final int timeout = call.getInt("timeout", 1500);
        new Thread(() -> {
            Map<String, JSObject> found = new LinkedHashMap<>();
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(250);
                byte[] q = MAGIC_Q.getBytes(StandardCharsets.UTF_8);
                List<InetAddress> targets = broadcastAddresses();
                for (int round = 0; round < 2; round++) {
                    for (InetAddress t : targets) {
                        try {
                            socket.send(new DatagramPacket(q, q.length, t, DISCOVERY_PORT));
                        } catch (Exception ignored) {
                        }
                    }
                    long until = System.currentTimeMillis() + (round == 0 ? 400 : Math.max(300, timeout - 400));
                    byte[] buf = new byte[4096];
                    while (System.currentTimeMillis() < until) {
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        try {
                            socket.receive(p);
                        } catch (SocketTimeoutException e) {
                            continue;
                        }
                        String s = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                        if (!s.startsWith(MAGIC_A)) continue;
                        try {
                            JSONObject info = new JSONObject(s.substring(MAGIC_A.length()));
                            String host = p.getAddress().getHostAddress();
                            int port = info.optInt("port", 3000);
                            JSObject srv = JSObject.fromJSONObject(info);
                            srv.put("host", host);
                            srv.put("address", host + ":" + port);
                            found.put(host + ":" + port, srv);
                        } catch (Exception ignored) {
                        }
                    }
                }
            } catch (Exception e) {
                // сеть недоступна — вернём то, что успели найти
            } finally {
                if (socket != null) socket.close();
            }
            JSArray arr = new JSArray();
            for (JSObject o : found.values()) arr.put(o);
            JSObject ret = new JSObject();
            ret.put("servers", arr);
            call.resolve(ret);
        }).start();
    }

    private static List<InetAddress> broadcastAddresses() {
        List<InetAddress> list = new ArrayList<>();
        try {
            list.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b != null && !list.contains(b)) list.add(b);
                }
            }
        } catch (Exception ignored) {
        }
        return list;
    }

    /** Ссылки и загрузки файлов — во внешнем браузере (он сохранит файл в «Загрузки») */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("bad url");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("no browser");
        }
    }

    /** Вход/выход из голосового канала: фоновая служба (голос не рвётся при погашенном экране) и маршрут звука */
    @PluginMethod
    public void setVoiceActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        Context ctx = getContext();
        Intent svc = new Intent(ctx, VoiceService.class);
        try {
            if (active) {
                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    ContextCompat.startForegroundService(ctx, svc);
                }
            } else {
                ctx.stopService(svc);
            }
        } catch (Exception ignored) {
            // без фоновой службы голос всё равно работает, пока приложение открыто
        }
        routeAudio(active);
        call.resolve();
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) setSpeakerphone(am, on);
        call.resolve();
    }

    private void routeAudio(boolean active) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (active) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            setSpeakerphone(am, !headsetConnected(am));
        } else {
            setSpeakerphone(am, false);
            am.setMode(AudioManager.MODE_NORMAL);
        }
    }

    @SuppressWarnings("deprecation")
    private static void setSpeakerphone(AudioManager am, boolean on) {
        am.setSpeakerphoneOn(on);
    }

    private static boolean headsetConnected(AudioManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                        || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                        || t == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    return true;
                }
            }
        }
        return false;
    }
}
