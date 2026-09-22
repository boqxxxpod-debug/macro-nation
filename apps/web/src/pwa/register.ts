import { registerSW } from "virtual:pwa-register";

let registered = false;

export function registerPwa(): void {
  if (registered || !("serviceWorker" in navigator)) {
    return;
  }

  registered = true;

  registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("macro-nation:pwa-update-available"));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("macro-nation:pwa-offline-ready"));
    },
  });
}
