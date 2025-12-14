import { BuilderScene } from './builder-scene';
import { BuilderUI } from './builder-ui';

// --- INITIALIZATION ---
const canvas = document.getElementById('renderCanvas');

async function main () {
	// 1. Initialize Scene Logic
	const builderScene = new BuilderScene(canvas);
	await builderScene.init();
	
	// 2. Initialize UI Logic
	// Note: Assets are not loaded yet. UI will trigger loadAssets via button.
	const builderUI = new BuilderUI(builderScene);
	builderUI.setup(null);
}

main();
