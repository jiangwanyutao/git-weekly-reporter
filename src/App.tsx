import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { Toaster } from '@/components/ui/toaster';
import Dashboard from '@/pages/Dashboard';
import SettingsPage from '@/pages/Settings';
import HistoryPage from '@/pages/History';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TitleBar } from '@/components/TitleBar';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './index.css';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function App() {
  useEffect(() => {
    if (!isTauri) return;
    void getCurrentWindow().show();
  }, []);
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground font-sans antialiased">
      <TitleBar />
      <Router>
        <SidebarProvider className="flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 flex flex-col h-full overflow-hidden w-full">
            <div className="p-2 md:hidden">
              <SidebarTrigger />
            </div>
            <div className="flex-1 overflow-hidden">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>
          </main>
          <Toaster />
        </SidebarProvider>
      </Router>
    </div>
  );
}

export default App;
