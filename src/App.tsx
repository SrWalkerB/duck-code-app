import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { StatusBar } from "@/components/status-bar";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { FilePanel } from "@/components/file-panel/file-panel";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { useAppStore } from "@/stores/app-store";

function App() {
  const isMac = navigator.userAgent.includes("Mac");
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const fetchProviderCatalog = useAppStore((s) => s.fetchProviderCatalog);
  const activeView = useAppStore((s) => s.activeView);
  const filePanelOpen = useAppStore((s) => s.filePanelOpen);
  const setFilePanelOpen = useAppStore((s) => s.setFilePanelOpen);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const terminalPanelOpen = useAppStore((s) => s.terminalPanelOpen);
  const terminalProjectPath = useAppStore((s) => s.terminalProjectPath);
  const setTerminalPanelOpen = useAppStore((s) => s.setTerminalPanelOpen);
  const projects = useAppStore((s) => s.projects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    fetchProjects();
    fetchProviderCatalog();
  }, [fetchProjects, fetchProviderCatalog]);

  useEffect(() => {
    document.body.classList.toggle("macos", isMac);
    return () => {
      document.body.classList.remove("macos");
    };
  }, [isMac]);

  if (activeView === "settings") {
    return (
      <div className="relative flex h-screen w-screen flex-col overflow-hidden min-h-0 app-window-content">
        {isMac && <div className="macos-drag-region" aria-hidden="true" />}
        <SettingsScreen />
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden min-h-0 app-window-content">
      {isMac && <div className="macos-drag-region" aria-hidden="true" />}
      <div className="flex flex-1 min-h-0">
        {sidebarOpen && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 min-h-0">
            <ChatArea />
            {filePanelOpen && activeProject && (
              <FilePanel
                projectPath={activeProject.path}
                onClose={() => setFilePanelOpen(false)}
              />
            )}
          </div>
          <StatusBar />
          {terminalPanelOpen && terminalProjectPath && (
            <TerminalPanel
              key={terminalProjectPath}
              projectPath={terminalProjectPath}
              onClose={() => setTerminalPanelOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
