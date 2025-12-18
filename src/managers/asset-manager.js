import * as BABYLON from '@babylonjs/core';

// Root path for assets (same as loader)
const ASSET_ROOT = './assets/objects/';

export class AssetManager {
	constructor(scene) {
		this.scene = scene;
		// Map: name -> { file: string, root: Mesh, thumbnail: string }
		this.store = new Map();
	}
	
	/**
	 * Loads an asset from a file and stores it as a template.
	 * The template mesh is enabled but hidden, to allow Instances.
	 * @param {string} name - Unique name for the asset in the store
	 * @param {string} file - File path relative to ASSET_ROOT (e.g. "nature/rock.glb")
	 * @param {string} thumbnail - URL to thumbnail image
	 */
	async addToStore(name, file, thumbnail) {
		if (this.store.has(name)) {
			console.warn(`Asset '${name}' already exists in store.`);
			return;
		}
		
		try {
			// Fix: Split file path to ensure textures in subfolders resolve correctly
			const lastSlashIndex = file.lastIndexOf('/');
			let rootUrl = ASSET_ROOT;
			let filename = file;
			
			if (lastSlashIndex !== -1) {
				rootUrl = ASSET_ROOT + file.substring(0, lastSlashIndex + 1);
				filename = file.substring(lastSlashIndex + 1);
			}
			
			// Load the mesh
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, filename, this.scene);
			const root = result.meshes[0];
			
			// Configure template mesh
			root.name = `TEMPLATE_${name}`;
			
			// OPTIMIZATION: Use Instances
			root.setEnabled(true);
			
			// Ensure world matrix is computed for bounds
			root.computeWorldMatrix(true);
			
			// Configure all meshes in the hierarchy
			const descendants = root.getChildMeshes(false);
			if (root instanceof BABYLON.Mesh) descendants.push(root);
			
			descendants.forEach(m => {
				m.isVisible = false; // Hide the template
				m.isPickable = false;
				m.checkCollisions = false;
				m.receiveShadows = true; // Default settings for source
				m.computeWorldMatrix(true);
				m.freezeWorldMatrix();
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
	 * Removes an asset from the store and disposes its template.
	 * @param {string} name - Asset name
	 */
	removeAsset(name) {
		const asset = this.store.get(name);
		if (asset) {
			if (asset.root) {
				asset.root.dispose(false, true);
			}
			this.store.delete(name);
			console.log(`[AssetManager] Removed '${name}' from store.`);
		}
	}
	
	/**
	 * Checks if an asset exists in the store
	 */
	hasAsset(name) {
		return this.store.has(name);
	}
	
	/**
	 * Gets the asset definition
	 */
	getAsset(name) {
		return this.store.get(name);
	}
	
	/**
	 * Creates a new instance of the asset in the scene.
	 * Uses InstancedMesh for geometry sharing to optimize memory.
	 * @param {string} name - Asset name
	 * @returns {BABYLON.Mesh|BABYLON.TransformNode} The new root
	 */
	instantiate(name) {
		const asset = this.store.get(name);
		if (!asset) {
			console.error(`Asset '${name}' not found in store.`);
			return null;
		}
		
		// Create hierarchy using Instances
		const newRoot = this._instantiateNode(asset.root);
		
		if (newRoot) {
			newRoot.name = name;
			newRoot.position = BABYLON.Vector3.Zero();
			newRoot.rotation = BABYLON.Vector3.Zero();
			newRoot.scaling = BABYLON.Vector3.One();
			
			if (!newRoot.metadata) newRoot.metadata = {};
		}
		
		return newRoot;
	}
	
	/**
	 * Recursively instantiates nodes.
	 */
	_instantiateNode(node, parent = null) {
		let newNode;
		
		if (node instanceof BABYLON.Mesh && node.geometry) {
			newNode = node.createInstance(node.name + "_i");
			newNode.isVisible = true;
			newNode.checkCollisions = false;
		} else {
			if (node instanceof BABYLON.Mesh || node instanceof BABYLON.TransformNode) {
				newNode = node.clone(node.name + "_c", parent, true);
			} else {
				newNode = node.clone(node.name + "_c", parent);
			}
			
			if (newNode) {
				if (newNode.setEnabled) newNode.setEnabled(true);
				if (newNode.isVisible !== undefined) newNode.isVisible = true;
				if (newNode.unfreezeWorldMatrix) newNode.unfreezeWorldMatrix();
			}
		}
		
		if (newNode) {
			newNode.parent = parent;
			node.getChildren().forEach(child => {
				this._instantiateNode(child, newNode);
			});
		}
		
		return newNode;
	}
	
	/**
	 * Returns all assets in the store as an array
	 */
	getAllAssets() {
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
	clear() {
		this.store.forEach(asset => {
			asset.root.dispose(false, true);
		});
		this.store.clear();
	}
}
