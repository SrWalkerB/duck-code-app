import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { StatusBar } from "@/components/status-bar";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { useAppStore } from "@/stores/app-store";

function App() {
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchProviderCatalog = useAppStore((s) => s.fetchProviderCatalog);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  useEffect(() => {
    fetchProjects();
    fetchProviderCatalog();
  }, [fetchProjects, fetchProviderCatalog]);

  if (activeView === "settings") {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden min-h-0">
        <SettingsScreen onBack={() => setActiveView("chat")} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden min-h-0">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <ChatArea />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
