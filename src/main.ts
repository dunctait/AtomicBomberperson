import './style.css';
import { showAssetLoaderScreen } from './ui/asset-loader-screen';
import { hasAssets } from './assets/asset-db';
import { StateMachine } from './engine/state-machine';
import { createTitleScreen } from './screens/title-screen';
import { createMainMenu } from './screens/main-menu';
import { createGameSetup } from './screens/game-setup';
import { createGameplayScreen } from './screens/gameplay-screen';
import { createRoundResults } from './screens/round-results';

async function main() {
  const app = document.createElement('div');
  app.id = 'app';
  document.body.appendChild(app);

  const cached = await hasAssets();
  if (!cached) {
    await showAssetLoaderScreen(app);
  }

  // Assets are ready -- set up the state machine
  app.innerHTML = '';

  const sm = new StateMachine(app);
  const transition = (state: string) => sm.transition(state);

  sm.register(createTitleScreen(transition));
  sm.register(createMainMenu(transition));
  sm.register(createGameSetup(transition));
  sm.register(createGameplayScreen(transition));
  sm.register(createRoundResults(transition));

  sm.start('title-screen');
}

main();
