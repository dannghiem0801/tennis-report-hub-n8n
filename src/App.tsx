import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { AppProvider } from "@/store/app-store";
import { TopBar } from "@/components/layout/top-bar";
import { DashboardPage } from "@/pages/dashboard-page";
import { ReportsPage } from "@/pages/reports-page";
import { TemplatesPage } from "@/pages/templates-page";
import { SettingsPage } from "@/pages/settings-page";

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
          <TopBar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#e2e8f0",
              fontSize: "13px",
            },
          }}
        />
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
