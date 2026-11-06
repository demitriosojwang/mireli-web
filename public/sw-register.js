// Registers the Mi-Reli service worker (minimal offline shell).
// Registration failure is non-fatal: the app is fully functional online.
if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}
