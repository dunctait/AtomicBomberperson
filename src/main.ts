import './style.css';
import { showAssetLoaderScreen } from './ui/asset-loader-screen';
import { StateMachine } from './engine/state-machine';
import { createTitleScreen } from './screens/title-screen';
import { createMainMenu } from './screens/main-menu';
import { createGameSetup } from './screens/game-setup';
import { createGameplayPlaceholder } from './screens/gameplay-placeholder';

async function main() {
  const app = document.createElement('div');
  app.id = 'app';
  document.body.appendChild(app);

  await showAssetLoaderScreen(app);

  // Assets are ready -- set up the state machine
  app.innerHTML = '';

  const sm = new StateMachine(app);
  const transition = (state: string) => sm.transition(state);

  sm.register(createTitleScreen(transition));
  sm.register(createMainMenu(transition));
  sm.register(createGameSetup(transition));
  sm.register(createGameplayPlaceholder(transition));

  sm.start('title-screen');
}

main();
