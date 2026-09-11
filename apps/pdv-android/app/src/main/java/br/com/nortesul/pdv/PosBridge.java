package br.com.nortesul.pdv;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class PosBridge {
    private final MainActivity activity;

    PosBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isStoneAvailable() {
        Intent intent = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("payment-app://pay")
        );
        return intent.resolveActivity(
                activity.getPackageManager()
        ) != null;
    }

    @JavascriptInterface
    public String getDeviceInfo() {
        JSONObject result = new JSONObject();

        try {
            boolean stone = isStoneAvailable();
            result.put(
                    "kind",
                    stone
                            ? "stone-smartpos"
                            : "android"
            );
            result.put(
                    "platform",
                    "Android " +
                            Build.VERSION.RELEASE
            );
            result.put(
                    "model",
                    Build.MANUFACTURER +
                            " " +
                            Build.MODEL
            );
            result.put(
                    "appVersion",
                    BuildConfig.VERSION_NAME
            );
            result.put(
                    "stoneAvailable",
                    stone
            );
            result.put(
                    "printerAvailable",
                    canResolve(
                            "printer-app://print"
                    )
            );
        } catch (JSONException ignored) {
        }

        return result.toString();
    }

    @JavascriptInterface
    public void pay(String payload) {
        activity.runOnUiThread(() -> {
            try {
                JSONObject data =
                        new JSONObject(payload);

                String requestId =
                        required(
                                data,
                                "requestId"
                        );

                Uri.Builder uri =
                        new Uri.Builder()
                                .scheme(
                                        "payment-app"
                                )
                                .authority(
                                        "pay"
                                )
                                .appendQueryParameter(
                                        "return_scheme",
                                        data.optString(
                                                "returnScheme",
                                                "nortesulpos"
                                        )
                                )
                                .appendQueryParameter(
                                        "amount",
                                        String.valueOf(
                                                data.getLong(
                                                        "amountCents"
                                                )
                                        )
                                )
                                .appendQueryParameter(
                                        "editable_amount",
                                        data.optBoolean(
                                                "editableAmount",
                                                false
                                        )
                                                ? "1"
                                                : "0"
                                )
                                .appendQueryParameter(
                                        "transaction_type",
                                        required(
                                                data,
                                                "transactionType"
                                        )
                                )
                                .appendQueryParameter(
                                        "installment_type",
                                        data.optString(
                                                "installmentType",
                                                "NONE"
                                        )
                                )
                                .appendQueryParameter(
                                        "installment_count",
                                        String.valueOf(
                                                data.optInt(
                                                        "installmentCount",
                                                        1
                                                )
                                        )
                                )
                                .appendQueryParameter(
                                        "order_id",
                                        data.optString(
                                                "orderId",
                                                ""
                                        )
                                );

                activity.rememberPending(
                        "payment",
                        requestId
                );

                launch(
                        uri.build(),
                        "norte-sul:stone-payment-result",
                        requestId
                );
            } catch (Exception error) {
                activity.dispatchFailure(
                        "norte-sul:stone-payment-result",
                        safeRequestId(payload),
                        error.getMessage()
                );
            }
        });
    }

    @JavascriptInterface
    public void cancel(String payload) {
        activity.runOnUiThread(() -> {
            try {
                JSONObject data =
                        new JSONObject(payload);

                String requestId =
                        required(
                                data,
                                "requestId"
                        );

                Uri uri =
                        new Uri.Builder()
                                .scheme(
                                        "cancel-app"
                                )
                                .authority(
                                        "cancel"
                                )
                                .appendQueryParameter(
                                        "returnscheme",
                                        data.optString(
                                                "returnScheme",
                                                "nortesulpos"
                                        )
                                )
                                .appendQueryParameter(
                                        "atk",
                                        required(
                                                data,
                                                "atk"
                                        )
                                )
                                .appendQueryParameter(
                                        "amount",
                                        String.valueOf(
                                                data.getLong(
                                                        "amountCents"
                                                )
                                        )
                                )
                                .appendQueryParameter(
                                        "editable_amount",
                                        "false"
                                )
                                .build();

                activity.rememberPending(
                        "cancel",
                        requestId
                );

                launch(
                        uri,
                        "norte-sul:stone-cancel-result",
                        requestId
                );
            } catch (Exception error) {
                activity.dispatchFailure(
                        "norte-sul:stone-cancel-result",
                        safeRequestId(payload),
                        error.getMessage()
                );
            }
        });
    }

    @JavascriptInterface
    public void print(String payload) {
        activity.runOnUiThread(() -> {
            try {
                JSONObject data =
                        new JSONObject(payload);

                String requestId =
                        required(
                                data,
                                "requestId"
                        );

                JSONArray printable =
                        data.getJSONArray(
                                "printable"
                        );

                Uri uri =
                        new Uri.Builder()
                                .scheme(
                                        "printer-app"
                                )
                                .authority(
                                        "print"
                                )
                                .appendQueryParameter(
                                        "SHOW_FEEDBACK_SCREEN",
                                        "false"
                                )
                                .appendQueryParameter(
                                        "SCHEME_RETURN",
                                        data.optString(
                                                "returnScheme",
                                                "nortesulpos"
                                        )
                                )
                                .appendQueryParameter(
                                        "PRINTABLE_CONTENT",
                                        printable.toString()
                                )
                                .build();

                activity.rememberPending(
                        "print",
                        requestId
                );

                launch(
                        uri,
                        "norte-sul:stone-print-result",
                        requestId
                );
            } catch (Exception error) {
                activity.dispatchFailure(
                        "norte-sul:stone-print-result",
                        safeRequestId(payload),
                        error.getMessage()
                );
            }
        });
    }

    private void launch(
            Uri uri,
            String event,
            String requestId
    ) {
        Intent intent =
                new Intent(
                        Intent.ACTION_VIEW,
                        uri
                );

        if (
                intent.resolveActivity(
                        activity.getPackageManager()
                ) == null
        ) {
            activity.dispatchFailure(
                    event,
                    requestId,
                    "Aplicativo Stone necessário não está instalado neste dispositivo."
            );
            return;
        }

        activity.startActivity(intent);
    }

    private boolean canResolve(String uri) {
        return new Intent(
                Intent.ACTION_VIEW,
                Uri.parse(uri)
        ).resolveActivity(
                activity.getPackageManager()
        ) != null;
    }

    private static String required(
            JSONObject object,
            String key
    ) throws JSONException {
        String value =
                object.getString(key);

        if (value.trim().isEmpty()) {
            throw new JSONException(
                    "Campo obrigatório ausente: " +
                            key
            );
        }

        return value;
    }

    private static String safeRequestId(
            String payload
    ) {
        try {
            return new JSONObject(payload)
                    .optString(
                            "requestId",
                            "unknown"
                    );
        } catch (Exception ignored) {
            return "unknown";
        }
    }
}
