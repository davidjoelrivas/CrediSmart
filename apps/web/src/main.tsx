import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // Por defecto TanStack Query PAUSA todo cuando no hay internet; aquí la aplicación maneja la falta de conexión
    // ella misma (guarda los cobros en una cola y avisa), así que debe intentar siempre y recibir el error.
    mutations: { networkMode: "always" },
    queries: {
      networkMode: "always",
      staleTime: 15_000,
      // Reintentar solo cuando es un problema de red o del servidor, nunca cuando el error es de la solicitud.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && failureCount < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// Solo en producción: el service worker guarda la aplicación para que abra sin internet.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
