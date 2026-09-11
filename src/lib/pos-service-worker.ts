export function registerPdvServiceWorker() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }
  if (
    window.location.protocol !== "https:" &&
    window.location.hostname !== "localhost"
  ) {
    return;
  }
  void navigator.serviceWorker
    .register("/pdv-sw.js", { scope: "/" })
    .catch(() => {
      // O PDV continua funcional online; a UI exibe o estado de conectividade.
    });
}
