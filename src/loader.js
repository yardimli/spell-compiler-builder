import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

const ASSET_FOLDER = "./assets/nature/";
const TIMEOUT_MS = 10000;

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
			finalAssets.push({
				file: file,
				src: cachedThumbnails[file],
				generated: false
			});
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
	
	const createScene = () => {
		const s = new BABYLON.Scene(engine);
		s.autoClear = false;
		s.clearColor = new BABYLON.Color4(0, 0, 0, 0);
		const h = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), s);
		h.intensity = 1.5;
		const d = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(1, -1, 1), s);
		d.intensity = 1.0;
		return s;
	};
	
	let thumbScene = createScene();
	let thumbCamera = new BABYLON.ArcRotateCamera("thumbCam", 0, 0, 0, BABYLON.Vector3.Zero(), thumbScene);
	
	engine.runRenderLoop(() => {
		thumbScene.render();
	});
	
	
	for (const file of files) {
		console.log(`[Loader] Processing: ${file}...`);
		
		try {
			const dataUrl = await Promise.race([
				processSingleFile(thumbScene, thumbCamera, engine, file),
				new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_MS))
			]);
			
			// --- NEW: UPLOAD TO SERVER ---
			await uploadThumbnail(dataUrl, file.replace('.glb', '.png'));
			
			results.push({
				file: file,
				src: dataUrl,
				generated: true
			});
			
		} catch (err) {
			console.error(`[Loader] Failed ${file}: ${err.message}`);
			// Recreate scene on error to ensure clean state
			thumbScene.dispose();
			thumbScene = createScene();
			thumbCamera = new BABYLON.ArcRotateCamera("thumbCam", 0, 0, 0, BABYLON.Vector3.Zero(), thumbScene);
			
			results.push({
				file: file,
				src: "https://via.placeholder.com/60?text=ERR",
				generated: false
			});
		}
		
		// Small delay to allow UI/Logs to update
		await new Promise(r => setTimeout(r, 100));
	}
	
	thumbScene.dispose();
	return results;
}

function processSingleFile(scene, camera, engine, file) {
	// Return a Promise so we can await the screenshot callback
	return new Promise(async (resolve, reject) => {
		let root = null;
		try {
			const result = await BABYLON.SceneLoader.ImportMeshAsync("", ASSET_FOLDER, file, scene);
			root = result.meshes[0];
			
			scene.animationGroups.forEach(ag => ag.stop());
			
			// Ensure bounds are calculated correctly
			root.computeWorldMatrix(true);
			result.meshes.forEach(m => m.computeWorldMatrix(true));
			
			const worldExtends = scene.getWorldExtends();
			const min = worldExtends.min;
			const max = worldExtends.max;
			
			if (min.equals(max)) {
				// Handle case where mesh has no size (e.g. empty node)
				min.set(-1, -1, -1);
				max.set(1, 1, 1);
			}
			
			const center = min.add(max).scale(0.5);
			const radius = max.subtract(min).length() * 0.8;
			
			// Position Camera
			camera.setPosition(new BABYLON.Vector3(0, radius * 0.5, radius * 1.5));
			camera.setTarget(center);
			camera.alpha = -Math.PI / 2;
			camera.beta = Math.PI / 2.5;
			
			// Ensure the camera is the active one for the scene
			scene.activeCamera = camera;
			
			console.log(`[Thumbnail] Camera positioned at ${camera.position.toString()}`);
			
			await scene.whenReadyAsync();
			
			// Render the scene to the canvas
			// Since the main render loop is not running yet (init phase), this is safe.
			scene.render();
			console.log(`[Thumbnail] Scene rendered for ${file}`);
			
			// Create Screenshot
			// Switched to CreateScreenshotAsync as it captures the canvas buffer directly.
			// CreateScreenshotUsingRenderTargetAsync can hang if the engine loop isn't active.
			const screenshotDataUrl = await BABYLON.Tools.CreateScreenshotAsync(
				engine,
				camera,
				{ width: 128, height: 128 },
				"image/png"
			);
			
			console.log(`[Thumbnail] Screenshot captured for ${file}`);
			resolve(screenshotDataUrl);
			
		} catch (e) {
			reject(e);
		} finally {
			if (root) {
				root.dispose(false, true);
			}
		}
	});
}

// --- AJAX UPLOAD FUNCTION ---
async function uploadThumbnail(dataUrl, filename) {
	try {
		const response = await fetch('/save-thumbnail', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				filename: filename,
				image: dataUrl
			})
		});
		
		if (!response.ok) {
			console.error("Server failed to save thumbnail");
		} else {
			console.log(`[Server] Saved ${filename}`);
		}
	} catch (e) {
		console.error("Error uploading thumbnail:", e);
	}
}
