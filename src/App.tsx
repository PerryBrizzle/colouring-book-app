import { useCallback, useEffect, useState } from 'react';
import { ColourScreen } from './screens/ColourScreen';
import { CreateScreen } from './screens/CreateScreen';
import { HomeScreen } from './screens/HomeScreen';

type Screen =
  | { name: 'home' }
  | { name: 'create'; file: Blob }
  | { name: 'colour'; id: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  // Each screen away from the library is a history entry, so the phone's
  // back button / gesture returns to the library instead of leaving the app.
  useEffect(() => {
    const onPop = () => setScreen({ name: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((next: Screen, replace = false) => {
    if (replace) history.replaceState({ screen: next.name }, '');
    else history.pushState({ screen: next.name }, '');
    setScreen(next);
  }, []);
  const back = useCallback(() => history.back(), []);

  switch (screen.name) {
    case 'create':
      return (
        <CreateScreen
          file={screen.file}
          onCancel={back}
          onCreated={(id) => open({ name: 'colour', id }, true)}
        />
      );
    case 'colour':
      return <ColourScreen key={screen.id} id={screen.id} onExit={back} />;
    default:
      return (
        <HomeScreen
          onNew={(file) => open({ name: 'create', file })}
          onOpen={(id) => open({ name: 'colour', id })}
        />
      );
  }
}
