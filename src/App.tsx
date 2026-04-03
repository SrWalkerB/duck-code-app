import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { StatusBar } from "@/components/status-bar";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { FilePanel } from "@/components/file-panel/file-panel";
import { useAppStore } from "@/stores/app-store";

function App() {
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchProviderCatalog = useAppStore((s) => s.fetchProviderCatalog);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const filePanelOpen = useAppStore((s) => s.filePanelOpen);
  const setFilePanelOpen = useAppStore((s) => s.setFilePanelOpen);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const projects = useAppStore((s) => s.projects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const activeProject = projects.find((p) => p.id === activeProjectId);

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
        {sidebarOpen && <Sidebar />}
        <ChatArea />
        {filePanelOpen && activeProject && (
          <FilePanel
            projectPath={activeProject.path}
            onClose={() => setFilePanelOpen(false)}
          />
        )}
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
