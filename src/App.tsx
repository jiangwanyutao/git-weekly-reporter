
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { Toaster } from '@/components/ui/toaster';
import Dashboard from '@/pages/Dashboard';
import SettingsPage from '@/pages/Settings';
import HistoryPage from '@/pages/History';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import './index.css';

function App() {
  return (
    <Router>
      <SidebarProvider className="h-screen w-screen overflow-hidden bg-background text-foreground font-sans antialiased">
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
  );
}

export default App;
