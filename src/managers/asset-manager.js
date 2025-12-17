import * as BABYLON from '@babylonjs/core';

// Root path for assets (same as loader)
const ASSET_ROOT = './assets/objects/';

export class AssetManager {
	constructor (scene) {
		this.scene = scene;
		// Map: name -> { file: string, root: Mesh, thumbnail: string }
		this.store = new Map();
	}
	
	/**
	 * Loads an asset from a file and stores it as a template.
	 * The template mesh is disabled and hidden.
	 * @param {string} name - Unique name for the asset in the store
	 * @param {string} file - File path relative to ASSET_ROOT (e.g. "nature/rock.glb")
	 * @param {string} thumbnail - URL to thumbnail image
	 */
	async addToStore (name, file, thumbnail) {
		if (this.store.has(name)) {
			console.warn(`Asset '${name}' already exists in store.`);
			return;
		}
		
		try {
			// Load the mesh
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_ROOT, file, this.scene);
			const root = result.meshes[0];
			
			// Configure template mesh
			root.name = `TEMPLATE_${name}`;
			root.setEnabled(false); // Hide it
			
			// Ensure world matrix is computed for bounds
			root.computeWorldMatrix(true);
			result.meshes.forEach(m => {
				m.isPickable = false;
				m.checkCollisions = false;
				m.receiveShadows = true; // Default settings
				m.computeWorldMatrix(true);
			});
			
			// Store it
			this.store.set(name, {
				file: file,
				root: root,
				thumbnail: thumbnail
			});
			
			console.log(`[AssetManager] Added '${name}' from '${file}'`);
		} catch (e) {
			console.error(`[AssetManager] Failed to load '${file}'`, e);
			throw e;
		}
	}
	
	/**
	 * Checks if an asset exists in the store
	 */
	hasAsset (name) {
		return this.store.has(name);
	}
	
	/**
	 * Gets the asset definition
	 */
	getAsset (name) {
		return this.store.get(name);
	}
	
	/**
	 * Creates a new instance of the asset in the scene.
	 * Uses instantiateHierarchy for efficient cloning.
	 * @param {string} name - Asset name
	 * @returns {BABYLON.Mesh} The new root mesh
	 */
	instantiate (name) {
		const asset = this.store.get(name);
		if (!asset) {
			console.error(`Asset '${name}' not found in store.`);
			return null;
		}
		
		// Clone the template
		const newRoot = asset.root.instantiateHierarchy();
		newRoot.setEnabled(true);
		newRoot.name = name;
		
		// Reset transform (instantiateHierarchy copies world transform)
		newRoot.position = BABYLON.Vector3.Zero();
		newRoot.rotation = BABYLON.Vector3.Zero();
		newRoot.scaling = BABYLON.Vector3.One();
		
		// Ensure metadata exists
		if (!newRoot.metadata) newRoot.metadata = {};
		
		return newRoot;
	}
	
	/**
	 * Returns all assets in the store as an array
	 */
	getAllAssets () {
		const list = [];
		this.store.forEach((value, key) => {
			list.push({
				name: key,
				file: value.file,
				thumbnail: value.thumbnail
			});
		});
		return list.sort((a, b) => a.name.localeCompare(b.name));
	}
	
	/**
	 * Clears the store and disposes template meshes
	 */
	clear () {
		this.store.forEach(asset => {
			asset.root.dispose(false, true);
		});
		this.store.clear();
	}
}
