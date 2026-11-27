import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { PageBoundary } from './components/PageBoundary';
import { Sidebar } from './components/Sidebar';
import { TaskDock } from './components/TaskDock';
import { call } from './lib/api';
import { useStore, type Page } from './lib/store';
import { BackupsPage } from './pages/Backups';
import { CharactersPage } from './pages/Characters';
import { ExtensionsPage } from './pages/Extensions';
import { HomePage } from './pages/Home';
import { ImagePage } from './pages/Image';
import { ModelsPage } from './pages/Models';
import { PhonePage } from './pages/Phone';
import { ResourcesPage } from './pages/Resources';
import { SettingsPage } from './pages/Settings';
import { TavernPage } from './pages/Tavern';
import { VoicePage } from './pages/Voice';
import { Setup } from './setup/Setup';
import { ConfirmHost, TipProvider, ToastHost } from './ui';

const PAGES: Record<Page, () => React.JSX.Element> = {
  home: HomePage,
  tavern: TavernPage,
  phone: PhonePage,
  models: ModelsPage,
  image: ImagePage,
  voice: VoicePage,
  extensions: ExtensionsPage,
  characters: CharactersPage,
  resources: ResourcesPage,
  backups: BackupsPage,
  settings: SettingsPage,
};

export function App() {
  const ready = useStore((s) => s.ready);
  const page = useStore((s) => s.page);
  const setupOpen = useStore((s) => s.setupOpen);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [page]);

  useEffect(() => {
    if (ready) void call('app:titlebar', page === 'home' && !setupOpen ? 'onDark' : 'auto');
  }, [ready, page, setupOpen]);

  if (!ready) return <div className="boot" />;
  const View = PAGES[page];
  return (
    <TipProvider>
      <div className="app" inert={setupOpen}>
        <Sidebar />
        <main className="main">
          <div className="titlebar drag" />
          <div className="scroller" ref={scroller}>
            <motion.div key={page} className="page" data-page={page} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.22, 0.8, 0.28, 1] }}>
              <PageBoundary page={page}>
                <View />
              </PageBoundary>
            </motion.div>
          </div>
        </main>
      </div>
      <AnimatePresence>{setupOpen && <Setup key="setup" />}</AnimatePresence>
      <TaskDock />
      <ConfirmHost />
      <ToastHost />
    </TipProvider>
  );
}
