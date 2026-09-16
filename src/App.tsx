import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { Toaster } from '@/components/ui/toaster';
import Dashboard from '@/pages/Dashboard';
import SettingsPage from '@/pages/Settings';
import HistoryPage from '@/pages/History';
import { TitleBar } from '@/components/TitleBar';
import { useApplyTheme } from '@/hooks/use-theme';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './index.css';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function App() {
  useApplyTheme();
  useEffect(() => {
    if (!isTauri) return;
    void getCurrentWindow().show();
  }, []);
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground antialiased">
      <TitleBar />
      <Router>
        <div className="flex flex-1 min-h-0">
          <AppSidebar />
          <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
        <Toaster />
      </Router>
    </div>
  );
}

export default App;
