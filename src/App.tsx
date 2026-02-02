import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { Toaster } from '@/components/ui/toaster';
import Dashboard from '@/pages/Dashboard';
import SettingsPage from '@/pages/Settings';
import HistoryPage from '@/pages/History';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import './index.css';

function App() {
  return (
    <Router>
      <SidebarProvider defaultOpen className="h-screen w-screen overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-col h-full overflow-hidden">
          <header className="flex h-12 items-center gap-2 px-4 border-b border-border/50 shrink-0 md:hidden">
            <SidebarTrigger className="-ml-1" />
          </header>
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </Router>
  );
}

export default App;
