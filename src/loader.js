import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

// Base folder for all object categories
const OBJECTS_ROOT = './assets/objects/';
const TIMEOUT_MS = 10000;

// Webpack require.context to scan all subfolders in assets/objects
// arguments: directory, useSubdirectories, regExp
const glbContext = require.context('../assets/objects', true, /\.glb$/);
const cacheContext = require.context('../assets/cache', true, /\.png$/);

/**
 * Returns a list of available folder names within assets/objects
 */
export function getAvailableFolders() {
	const folders = new Set();
	glbContext.keys().forEach(key => {
		// key format is usually "./folderName/fileName.glb"
		const parts = key.split('/');
		if (parts.length >= 3) {
			// parts[0] is '.', parts[1] is the folder name
			folders.add(parts[1]);
		}
	});
	return Array.from(folders).sort();
}

// Modified to accept scene, camera, and the specific folder to load
export async function loadAssets(scene, camera, folderName) {
	const engine = scene.getEngine();
	
	// 1. Filter GLB files for the selected folder
	const glbFiles = glbContext.keys()
		.filter(key => key.startsWith(`./${folderName}/`))
		.map(key => key.replace('./', '')); // Remove leading ./ to get "folder/file.glb"
	
	// 2. Scan existing PNG cache (Webpack Build-time knowledge)
	const cachedThumbnails = {};
	cacheContext.keys().forEach(key => {
		const filename = key.replace('./', ''); // "folder/file.png"
		const glbName = filename.replace('.png', '.glb');
		cachedThumbnails[glbName] = cacheContext(key);
	});
	
	const finalAssets = [];
	const potentiallyMissing = [];
	
	// 3. Sort based on Build-time cache
	glbFiles.forEach(file => {
		if (cachedThumbnails[file]) {
			finalAssets.push({
				file: file, // This now includes the folder path e.g. "nature/rock.glb"
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
		console.log(`[Loader] Generating ${actuallyMissing.length} missing thumbnails for ${folderName}...`);
		const generated = await generateThumbnails(scene, camera, actuallyMissing);
		finalAssets.push(...generated);
	}
	
	// Sort by filename to keep UI consistent
	finalAssets.sort((a, b) => a.file.localeCompare(b.file));
	
	return finalAssets;
}

// Rewritten to use the main scene and camera
async function generateThumbnails(scene, camera, files) {
	const engine = scene.getEngine();
	const results = [];
	
	for (const file of files) {
		console.log(`[Loader] Processing: ${file}...`);
		
		try {
			const dataUrl = await Promise.race([
				processSingleFile(scene, camera, engine, file),
				new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS))
			]);
			
			// --- UPLOAD TO SERVER ---
			// file contains folder path e.g. "nature/rock.glb" -> save as "nature/rock.png"
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

function processSingleFile(scene, camera, engine, file) {
	// Return a Promise so we can await the screenshot callback
	return new Promise(async (resolve, reject) => {
		let root = null;
		let light = null; // Variable for temporary light
		
		try {
			// Create a temporary HemisphericLight to ensure the asset is visible
			// This fixes the issue where assets appear black during thumbnail generation
			light = new BABYLON.HemisphericLight('thumbnail_light', new BABYLON.Vector3(0, 1, 0), scene);
			light.intensity = 1.0;
			light.groundColor = new BABYLON.Color3(0.2, 0.2, 0.2); // Slight ambient from bottom
			light.specular = new BABYLON.Color3(0, 0, 0); // Reduce specular to avoid glare
			
			// Import into the main scene
			// OBJECTS_ROOT is "./assets/objects/"
			// file is "folder/filename.glb" e.g. "nature/rock.glb"
			
			// Fix: Split path to ensure relative textures load correctly
			const lastSlashIndex = file.lastIndexOf('/');
			let rootUrl = OBJECTS_ROOT;
			let filename = file;
			
			if (lastSlashIndex !== -1) {
				rootUrl = OBJECTS_ROOT + file.substring(0, lastSlashIndex + 1);
				filename = file.substring(lastSlashIndex + 1);
			}
			
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, filename, scene);
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
			if (light) {
				// Clean up the temporary light
				light.dispose();
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
			console.error('Server failed to save thumbnail');
		} else {
			console.log(`[Server] Saved ${filename}`);
		}
	} catch (e) {
		console.error('Error uploading thumbnail:', e);
	}
}
