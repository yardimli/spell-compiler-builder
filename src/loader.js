import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const ASSET_FOLDER = './assets/nature/';
const TIMEOUT_MS = 10000;

// Modified to accept scene and camera from the main application
export async function loadAssets (scene, camera) {
	const engine = scene.getEngine();
	
	// 1. Scan GLB files
	const assetContext = require.context('../assets/nature', false, /\.glb$/);
	const glbFiles = assetContext.keys().map(key => key.replace('./', ''));
	
	// 2. Scan existing PNG cache (Webpack Build-time knowledge)
	const cacheContext = require.context('../assets/cache', false, /\.png$/);
	const cachedThumbnails = {};
	cacheContext.keys().forEach(key => {
		const filename = key.replace('./', '');
		const glbName = filename.replace('.png', '.glb');
		cachedThumbnails[glbName] = cacheContext(key);
	});
	
	const finalAssets = [];
	const potentiallyMissing = [];
	
	// 3. Sort based on Build-time cache
	glbFiles.forEach(file => {
		if (cachedThumbnails[file]) {
			finalAssets.push({
				file: file,
				src: cachedThumbnails[file],
				generated: false
			});
		} else {
			potentiallyMissing.push(file);
		}
	});
	
	// 4. Check Runtime Cache (Server-side check for files added after build)
	const actuallyMissing = [];
	
	await Promise.all(potentiallyMissing.map(async (file) => {
		const pngName = file.replace('.glb', '.png');
		// Construct path relative to the served HTML
		// Add timestamp to bypass browser cache of previous 404s
		const url = `assets/cache/${pngName}`;
		const checkUrl = `${url}?t=${Date.now()}`;
		
		try {
			// Check if file exists on server
			const response = await fetch(checkUrl, { method: 'HEAD' });
			if (response.ok) {
				finalAssets.push({
					file: file,
					src: url, // Use clean URL for the src
					generated: false
				});
			} else {
				actuallyMissing.push(file);
			}
		} catch (e) {
			actuallyMissing.push(file);
		}
	}));
	
	// 5. Generate Missing using the provided scene and camera
	if (actuallyMissing.length > 0) {
		console.log(`[Loader] Generating ${actuallyMissing.length} missing thumbnails...`);
		const generated = await generateThumbnails(scene, camera, actuallyMissing);
		finalAssets.push(...generated);
	}
	
	// Sort by filename to keep UI consistent
	finalAssets.sort((a, b) => a.file.localeCompare(b.file));
	
	return finalAssets;
}

// Rewritten to use the main scene and camera
async function generateThumbnails (scene, camera, files) {
	const engine = scene.getEngine();
	const results = [];
	
	// Ensure the engine is rendering to capture screenshots
	// We don't need a separate render loop here because the main loop in builder-scene is running.
	
	for (const file of files) {
		console.log(`[Loader] Processing: ${file}...`);
		
		try {
			const dataUrl = await Promise.race([
				processSingleFile(scene, camera, engine, file),
				new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS))
			]);
			
			// --- UPLOAD TO SERVER ---
			await uploadThumbnail(dataUrl, file.replace('.glb', '.png'));
			
			results.push({
				file: file,
				src: dataUrl,
				generated: true
			});
		} catch (err) {
			console.error(`[Loader] Failed ${file}: ${err.message}`);
			
			results.push({
				file: file,
				src: 'https://via.placeholder.com/60?text=ERR',
				generated: false
			});
		}
		
		// Small delay to allow UI/Logs to update and scene to clear
		await new Promise(r => setTimeout(r, 100));
	}
	
	return results;
}

function processSingleFile (scene, camera, engine, file) {
	// Return a Promise so we can await the screenshot callback
	return new Promise(async (resolve, reject) => {
		let root = null;
		try {
			// Import into the main scene
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, file, scene);
			root = result.meshes[0];
			
			// Stop any animations that might have auto-played
			scene.animationGroups.forEach(ag => ag.stop());
			
			// Ensure bounds are calculated correctly
			root.computeWorldMatrix(true);
			result.meshes.forEach(m => m.computeWorldMatrix(true));
			
			const bounds = root.getHierarchyBoundingVectors();
			const min = bounds.min;
			const max = bounds.max;
			
			if (min.equals(max)) {
				// Handle case where mesh has no size (e.g. empty node)
				min.set(-1, -1, -1);
				max.set(1, 1, 1);
			}
			
			const center = min.add(max).scale(0.5);
			const radius = max.subtract(min).length() * 0.8;
			
			// Position Camera for the thumbnail
			camera.setPosition(new BABYLON.Vector3(0, radius * 0.5, radius * 1.5).add(center));
			camera.setTarget(center);
			camera.alpha = -Math.PI / 2;
			camera.beta = Math.PI / 2.5;
			
			// Ensure the camera is the active one for the scene
			scene.activeCamera = camera;
			
			// Wait for the scene to be ready with the new mesh
			await scene.whenReadyAsync();
			
			// Force a render to ensure the mesh is drawn on the canvas
			scene.render();
			
			// Create Screenshot
			const screenshotDataUrl = await BABYLON.Tools.CreateScreenshotAsync(
				engine,
				camera,
				{ width: 128, height: 128 },
				'image/png'
			);
			
			console.log(`[Thumbnail] Screenshot captured for ${file}`);
			
			resolve(screenshotDataUrl);
		} catch (e) {
			reject(e);
		} finally {
			if (root) {
				// Clean up the mesh immediately
				root.dispose(false, true);
			}
		}
	});
}

// --- AJAX UPLOAD FUNCTION ---
async function uploadThumbnail (dataUrl, filename) {
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
			console.error('Server failed to save thumbnail');
		} else {
			console.log(`[Server] Saved ${filename}`);
		}
	} catch (e) {
		console.error('Error uploading thumbnail:', e);
	}
}
