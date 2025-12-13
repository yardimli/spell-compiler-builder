import { BuilderScene } from './builder-scene';
import { BuilderUI } from './builder-ui';

// --- INITIALIZATION ---
const canvas = document.getElementById('renderCanvas');

async function main () {
	// 1. Initialize Scene Logic
	const builderScene = new BuilderScene(canvas);
	const assets = await builderScene.init();
	
	// 2. Initialize UI Logic
	const builderUI = new BuilderUI(builderScene);
	builderUI.setup(assets);
}

main();
