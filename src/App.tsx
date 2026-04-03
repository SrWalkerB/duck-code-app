import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { SkillsScreen } from "@/components/skills/skills-screen";
import { StatusBar } from "@/components/status-bar";
import { useAppStore } from "@/stores/app-store";

function App() {
  const fetchProjects = useAppStore((s) => s.fetchProjects);
  const activeView = useAppStore((s) => s.activeView);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden min-h-0">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        {activeView === "skills" ? <SkillsScreen /> : <ChatArea />}
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
