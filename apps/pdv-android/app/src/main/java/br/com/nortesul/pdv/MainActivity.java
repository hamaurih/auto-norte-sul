package br.com.nortesul.pdv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.Set;

public final class MainActivity extends Activity {
    private static final String PREFS =
            "norte_sul_pos_bridge";

    private WebView webView;

    @Override
    protected void onCreate(
            Bundle savedInstanceState
    ) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        configureWebView(webView);
        setContentView(webView);

        webView.loadUrl(
                BuildConfig.POS_URL
        );

        handleStoneReturn(
                getIntent()
        );
    }

    private void configureWebView(
            WebView view
    ) {
        WebSettings settings =
                view.getSettings();

        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(
                WebSettings.MIXED_CONTENT_NEVER_ALLOW
        );
        settings.setUserAgentString(
                settings.getUserAgentString() +
                        " NorteSulPDV/" +
                        BuildConfig.VERSION_NAME
        );

        CookieManager cookies =
                CookieManager.getInstance();

        cookies.setAcceptCookie(true);
        CookieManager.setAcceptThirdPartyCookies(
                view,
                true
        );

        view.addJavascriptInterface(
                new PosBridge(this),
                "NorteSulPOS"
        );

        view.setWebChromeClient(
                new WebChromeClient()
        );

        view.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(
                            WebView webView,
                            WebResourceRequest request
                    ) {
                        Uri uri =
                                request.getUrl();

                        if (
                                isTrustedWebOrigin(
                                        uri
                                )
                        ) {
                            return false;
                        }

                        try {
                            startActivity(
                                    new Intent(
                                            Intent.ACTION_VIEW,
                                            uri
                                    )
                            );
                        } catch (
                                Exception ignored
                        ) {
                            Toast.makeText(
                                    MainActivity.this,
                                    "Não foi possível abrir o link externo.",
                                    Toast.LENGTH_SHORT
                            ).show();
                        }

                        return true;
                    }
                }
        );
    }

    private boolean isTrustedWebOrigin(
            Uri uri
    ) {
        if (
                !"https".equalsIgnoreCase(
                        uri.getScheme()
                )
        ) {
            return false;
        }

        String host = uri.getHost();

        if (host == null) {
            return false;
        }

        return host.equals(
                "nortesulauto.com.br"
        )
                || host.equals(
                        "www.nortesulauto.com.br"
                )
                || host.equals(
                        "pzwjbitjersngordgcsh.supabase.co"
                );
    }

    @Override
    protected void onNewIntent(
            Intent intent
    ) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleStoneReturn(intent);
    }

    private void handleStoneReturn(
            Intent intent
    ) {
        if (
                intent == null ||
                intent.getData() == null
        ) {
            return;
        }

        Uri uri = intent.getData();

        if (
                !"nortesulpos".equalsIgnoreCase(
                        uri.getScheme()
                )
        ) {
            return;
        }

        String host =
                uri.getHost() == null
                        ? ""
                        : uri.getHost();

        if (
                host.equals("pay-response")
        ) {
            dispatchStoneResult(
                    "norte-sul:stone-payment-result",
                    "payment",
                    uri,
                    "0".equals(
                            uri.getQueryParameter(
                                    "code"
                            )
                    )
            );
        } else if (
                host.equals("cancel")
        ) {
            dispatchStoneResult(
                    "norte-sul:stone-cancel-result",
                    "cancel",
                    uri,
                    "true".equalsIgnoreCase(
                            uri.getQueryParameter(
                                    "success"
                            )
                    )
            );
        } else if (
                host.equals("print") ||
                host.equals("reprint")
        ) {
            String status =
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "status"
                            ),
                            uri.getQueryParameter(
                                    "result"
                            ),
                            uri.getQueryParameter(
                                    "code"
                            )
                    );

            dispatchStoneResult(
                    "norte-sul:stone-print-result",
                    "print",
                    uri,
                    status == null ||
                            "SUCCESS".equalsIgnoreCase(
                                    status
                            ) ||
                            "0".equals(status)
            );
        }
    }

    void rememberPending(
            String type,
            String requestId
    ) {
        getSharedPreferences(
                PREFS,
                MODE_PRIVATE
        )
                .edit()
                .putString(
                        "pending_" + type,
                        requestId
                )
                .apply();
    }

    private String takePending(
            String type
    ) {
        String key =
                "pending_" + type;

        String value =
                getSharedPreferences(
                        PREFS,
                        MODE_PRIVATE
                )
                        .getString(
                                key,
                                "unknown"
                        );

        getSharedPreferences(
                PREFS,
                MODE_PRIVATE
        )
                .edit()
                .remove(key)
                .apply();

        return value == null
                ? "unknown"
                : value;
    }

    private void dispatchStoneResult(
            String eventName,
            String type,
            Uri uri,
            boolean ok
    ) {
        try {
            JSONObject data =
                    new JSONObject();

            data.put(
                    "requestId",
                    takePending(type)
            );
            data.put(
                    "ok",
                    ok
            );

            JSONObject raw =
                    new JSONObject();

            Set<String> names =
                    uri.getQueryParameterNames();

            for (String name : names) {
                raw.put(
                        name,
                        firstNonBlank(
                                uri.getQueryParameter(
                                        name
                                ),
                                ""
                        )
                );
            }

            data.put(
                    "raw",
                    raw
            );

            data.put(
                    "code",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "code"
                            ),
                            uri.getQueryParameter(
                                    "responsecode"
                            ),
                            uri.getQueryParameter(
                                    "response_code"
                            ),
                            ok ? "0" : "-1"
                    )
            );

            data.put(
                    "message",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "message"
                            ),
                            uri.getQueryParameter(
                                    "reason"
                            ),
                            ok
                                    ? "Aprovado"
                                    : "Operação não aprovada"
                    )
            );

            data.put(
                    "atk",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "atk"
                            ),
                            ""
                    )
            );

            data.put(
                    "itk",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "itk"
                            ),
                            ""
                    )
            );

            data.put(
                    "authorizationCode",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "authorization_code"
                            ),
                            uri.getQueryParameter(
                                    "authorizationcode"
                            ),
                            ""
                    )
            );

            data.put(
                    "brand",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "brand"
                            ),
                            ""
                    )
            );

            data.put(
                    "pan",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "pan"
                            ),
                            ""
                    )
            );

            data.put(
                    "entryMode",
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "entry_mode"
                            ),
                            ""
                    )
            );

            String amount =
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "amount"
                            ),
                            uri.getQueryParameter(
                                    "transactionamount"
                            )
                    );

            if (
                    amount != null &&
                    !amount.isEmpty()
            ) {
                try {
                    data.put(
                            "amount",
                            Long.parseLong(
                                    amount
                            ) / 100.0
                    );
                } catch (
                        NumberFormatException ignored
                ) {
                }
            }

            String installments =
                    uri.getQueryParameter(
                            "installment_count"
                    );

            if (
                    installments != null
            ) {
                try {
                    data.put(
                            "installments",
                            Integer.parseInt(
                                    installments
                            )
                    );
                } catch (
                        NumberFormatException ignored
                ) {
                }
            }

            String providerReference =
                    firstNonBlank(
                            uri.getQueryParameter(
                                    "atk"
                            ),
                            uri.getQueryParameter(
                                    "itk"
                            ),
                            uri.getQueryParameter(
                                    "authorization_code"
                            ),
                            uri.getQueryParameter(
                                    "authorizationcode"
                            )
                    );

            data.put(
                    "providerReference",
                    providerReference == null
                            ? ""
                            : providerReference
            );

            dispatchEvent(
                    eventName,
                    data
            );
        } catch (Exception error) {
            dispatchFailure(
                    eventName,
                    "unknown",
                    error.getMessage()
            );
        }
    }

    void dispatchFailure(
            String eventName,
            String requestId,
            String message
    ) {
        try {
            JSONObject data =
                    new JSONObject();

            data.put(
                    "requestId",
                    requestId == null
                            ? "unknown"
                            : requestId
            );

            data.put(
                    "ok",
                    false
            );
            data.put(
                    "code",
                    "BRIDGE_ERROR"
            );
            data.put(
                    "message",
                    message == null
                            ? "Falha na integração nativa"
                            : message
            );
            data.put(
                    "raw",
                    new JSONObject()
            );

            dispatchEvent(
                    eventName,
                    data
            );
        } catch (Exception ignored) {
        }
    }

    private void dispatchEvent(
            String eventName,
            JSONObject payload
    ) {
        String js =
                "window.dispatchEvent(new CustomEvent(" +
                        JSONObject.quote(
                                eventName
                        ) +
                        ", {detail:" +
                        payload.toString() +
                        "}));";

        webView.post(
                () ->
                        webView.evaluateJavascript(
                                js,
                                null
                        )
        );
    }

    private static String firstNonBlank(
            String... values
    ) {
        for (String value : values) {
            if (
                    value != null &&
                    !value.trim().isEmpty()
            ) {
                return value;
            }
        }

        return null;
    }

    @Override
    public void onBackPressed() {
        if (
                webView != null &&
                webView.canGoBack()
        ) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
