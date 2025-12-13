import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

const ASSET_FOLDER = "./assets/nature/";
const TIMEOUT_MS = 10000; // Increased to 10s to allow shader compilation

export async function loadAssets(engine) {
	// 1. Scan GLB files
	const assetContext = require.context('../assets/nature', false, /\.glb$/);
	const glbFiles = assetContext.keys().map(key => key.replace('./', ''));
	
	// 2. Scan existing PNG cache
	const cacheContext = require.context('../assets/cache', false, /\.png$/);
	const cachedThumbnails = {};
	cacheContext.keys().forEach(key => {
		const filename = key.replace('./', '');
		const glbName = filename.replace('.png', '.glb');
		cachedThumbnails[glbName] = cacheContext(key);
	});
	
	const finalAssets = [];
	const missingThumbnails = [];
	
	// 3. Sort
	glbFiles.forEach(file => {
		if (cachedThumbnails[file]) {
			finalAssets.push({ file: file, src: cachedThumbnails[file], generated: false });
		} else {
			missingThumbnails.push(file);
		}
	});
	
	// 4. Generate Missing
	if (missingThumbnails.length > 0) {
		console.log(`[Loader] Generating ${missingThumbnails.length} missing thumbnails...`);
		const generated = await generateThumbnails(engine, missingThumbnails);
		finalAssets.push(...generated);
	}
	
	return finalAssets;
}

async function generateThumbnails(engine, files) {
	const results = [];
	
	// Helper to create a fresh scene
	const createScene = () => {
		const s = new BABYLON.Scene(engine);
		s.autoClear = false;
		s.clearColor = new BABYLON.Color4(0, 0, 0, 0);
		// Bright generic lighting
		const h = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), s);
		h.intensity = 1.5;
		const d = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(1, -1, 1), s);
		d.intensity = 1.0;
		return s;
	};
	
	let thumbScene = createScene();
	let thumbCamera = new BABYLON.ArcRotateCamera("thumbCam", 0, 0, 0, BABYLON.Vector3.Zero(), thumbScene);
	
	for (const file of files) {
		console.log(`[Loader] Processing: ${file}...`);
		
		try {
			const dataUrl = await Promise.race([
				processSingleFile(thumbScene, thumbCamera, engine, file),
				new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_MS))
			]);
			
			// Success
			triggerDownload(dataUrl, file.replace('.glb', '.png'));
			results.push({ file: file, src: dataUrl, generated: true });
			
		} catch (err) {
			console.error(`[Loader] Failed ${file}: ${err.message}`);
			
			// If failed, dispose and recreate scene to ensure clean state
			thumbScene.dispose();
			thumbScene = createScene();
			thumbCamera = new BABYLON.ArcRotateCamera("thumbCam", 0, 0, 0, BABYLON.Vector3.Zero(), thumbScene);
			
			results.push({
				file: file,
				src: "https://via.placeholder.com/60?text=ERR",
				generated: false
			});
		}
		
		// Small breather
		await new Promise(r => setTimeout(r, 100));
	}
	
	thumbScene.dispose();
	return results;
}

async function processSingleFile(scene, camera, engine, file) {
	// 1. Import
	const result = await BABYLON.SceneLoader.ImportMeshAsync("", ASSET_FOLDER, file, scene);
	const root = result.meshes[0];
	console.log(`[Thumbnail] Imported root: ${root.name}`);
	
	// 2. Stop Animations (prevents weird poses or updates during screenshot)
	scene.animationGroups.forEach(ag => ag.stop());
	
	// 3. Force World Matrix Update (Crucial for Bounding Box)
	root.computeWorldMatrix(true);
	result.meshes.forEach(m => m.computeWorldMatrix(true));
	
	// 4. Calculate Bounds
	const worldExtends = scene.getWorldExtends();
	const min = worldExtends.min;
	const max = worldExtends.max;
	
	// Handle empty bounds
	if (min.equals(max)) {
		root.dispose();
		throw new Error("Empty mesh bounds");
	}
	
	console.log(`[Thumbnail] Bounds Min: ${min.toString()}, Max: ${max.toString()}`);
	
	const center = min.add(max).scale(0.5);
	const radius = max.subtract(min).length() * 0.8;
	
	// 5. Position Camera
	camera.setPosition(new BABYLON.Vector3(0, radius * 0.5, radius * 1.5));
	camera.setTarget(center);
	camera.alpha = -Math.PI / 2; // Front view usually
	camera.beta = Math.PI / 2.5; // Slightly elevated
	
	console.log(`[Thumbnail] Camera Pos: ${camera.position.toString()}, Target: ${camera.target.toString()}`);
	
	scene.render();
	console.log(`[Thumbnail] Scene rendered, capturing screenshot...`);
	BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(
		engine,
		camera,
		{ width: 128, height: 128 }
	).then(data => {
		root.dispose(false, true); // Cleanup
		resolve(data);
	});
}

function triggerDownload(dataUrl, filename) {
	const a = document.createElement("a");
	a.href = dataUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}
