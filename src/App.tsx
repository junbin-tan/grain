import { useEffect } from "react";
import { AppProvider, useApp } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { SearchPalette } from "./components/SearchPalette";
import { Spinner } from "./components/ui";
import { Home } from "./pages/Home";
import { MeetingPage } from "./pages/MeetingPage";
import { ChatPage } from "./pages/ChatPage";
import { ActionsPage } from "./pages/ActionsPage";
import { ModelsPage } from "./pages/ModelsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Onboarding } from "./pages/Onboarding";

function Shell() {
  const { ready, route, navigate, back, settings, newMeeting, setSearchOpen } = useApp();

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "n") { e.preventDefault(); newMeeting(false); }
      if (e.key === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === ",") { e.preventDefault(); navigate({ name: "settings" }); }
      if (e.key === "[") { e.preventDefault(); back(); }
      if (e.key === "j" && route.name !== "meeting") { e.preventDefault(); navigate({ name: "chat" }); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [route, newMeeting]);

  if (!ready) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!settings.onboardingDone) return <><Onboarding /><Toasts /></>;

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1">
        {route.name === "home" && <Home />}
        {route.name === "meeting" && <MeetingPage key={route.id} id={route.id} tab={route.tab} at={route.at} />}
        {route.name === "chat" && <ChatPage threadId={route.threadId} />}
        {route.name === "actions" && <ActionsPage />}
        {route.name === "models" && <ModelsPage role={route.role} />}
        {route.name === "settings" && <SettingsPage section={route.section} />}
      </main>
      <SearchPalette />
      <Toasts />
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
