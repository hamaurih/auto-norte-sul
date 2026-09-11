import { useEffect, useState } from "react";
import {
  CircleCheck,
  CloudOff,
  RefreshCw,
  Smartphone,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { countPendingPosSales } from "@/lib/pos-offline";
import {
  getPosDeviceInfo,
  type PosDeviceInfo,
} from "@/lib/pos-device";
import { registerPdvServiceWorker } from "@/lib/pos-service-worker";

export function PdvConnectionStatus({
  onSync,
}: {
  onSync?: () => Promise<void> | void;
}) {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pending, setPending] = useState(0);
  const [device, setDevice] = useState<PosDeviceInfo>(() =>
    getPosDeviceInfo(),
  );
  const [syncing, setSyncing] = useState(false);

  async function refreshPending() {
    try {
      setPending(await countPendingPosSales());
    } catch {
      setPending(0);
    }
  }

  useEffect(() => {
    registerPdvServiceWorker();
    setDevice(getPosDeviceInfo());
    void refreshPending();

    const onOnline = () => {
      setOnline(true);
      void refreshPending();
    };
    const onOffline = () => setOnline(false);
    const onOutbox = () => void refreshPending();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(
      "norte-sul:pos-outbox-changed",
      onOutbox,
    );

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(
        "norte-sul:pos-outbox-changed",
        onOutbox,
      );
    };
  }, []);

  async function sync() {
    if (!onSync || !online || syncing) return;
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
      await refreshPending();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={online ? "secondary" : "destructive"}
        className="gap-1.5 py-1"
      >
        {online ? (
          <Wifi className="h-3.5 w-3.5" />
        ) : (
          <CloudOff className="h-3.5 w-3.5" />
        )}
        {online ? "Online" : "Contingência"}
      </Badge>

      <Badge variant="outline" className="gap-1.5 py-1">
        <Smartphone className="h-3.5 w-3.5" />
        {device.kind === "stone-smartpos"
          ? "Stone SmartPOS"
          : device.kind === "android"
            ? "Android"
            : "Navegador"}
      </Badge>

      {device.stoneAvailable ? (
        <Badge
          variant="outline"
          className="gap-1.5 py-1 text-emerald-700"
        >
          <CircleCheck className="h-3.5 w-3.5" />
          Stone pronta
        </Badge>
      ) : null}

      {pending > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          disabled={!online || syncing || !onSync}
          onClick={sync}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
          />
          {pending} pendente{pending === 1 ? "" : "s"}
        </Button>
      ) : null}
    </div>
  );
}
