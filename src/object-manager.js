import * as BABYLON from '@babylonjs/core';
import { UndoRedoManager } from './undo-redo';
import { GizmoController } from './managers/gizmo-controller';
import { GroupManager } from './managers/group-manager';
import { AlignmentManager } from './managers/alignment-manager';
import { PropertyManager } from './managers/property-manager';
import { OperationManager } from './managers/operation-manager';
import { SnapManager } from './managers/snap-manager';
import { LightManager } from './managers/light-manager';
import { AssetManager } from './managers/asset-manager';

const LS_AUTOSAVE_KEY = 'builder_autosave_map';
const LS_SELECTION_KEY = 'builder_selection_state';

export class ObjectManager {
	constructor (builderScene) {
		this.builderScene = builderScene;
		this.scene = builderScene.scene;

		// State
		this.placedObjects = [];
		this.groups = [];
		this.selectedMeshes = [];
		this.selectionProxy = null;

		// This now refers to the Asset Name in the store, not the file path
		this.activeAssetName = null;

		// Ghost State
		this.ghostMesh = null;
		this.ghostPosition = BABYLON.Vector3.Zero();
		this.ghostOffset = 0;
		this.ghostBoundsLocal = null;

		// Settings
		this._gridSize = 2.5;
		this.defaultYOffset = 0;
		this.autoSaveEnabled = true;
		this.cursorIncrement = 0.05;

		this.posStep = 0.1;
		this.rotStep = 15;
		this.scaleStep = 0.1;

		// Events
		this.onSelectionChange = null;
		this.onListChange = null;
		this.onAssetSelectionChange = null;
		this.onStoreChange = null;

		// Managers
		this.undoRedo = new UndoRedoManager(this);
		this.gizmoController = new GizmoController(this);
		this.groupManager = new GroupManager(this);
		this.alignmentManager = new AlignmentManager(this);
		this.propertyManager = new PropertyManager(this);
		this.operationManager = new OperationManager(this);
		this.snapManager = new SnapManager(this);
		this.lightManager = new LightManager(this);

		// Initialize Asset Manager
		this.assetManager = new AssetManager(this.scene);
	}

	get gridSize () { return this._gridSize; }
	set gridSize (val) {
		this._gridSize = val;
		this.gizmoController.updateGizmoSettings();
	}

	// Delegate methods...
	get gizmoManager () { return this.gizmoController.gizmoManager; }
	setGizmoMode (mode) { this.gizmoController.setMode(mode); }
	updateGizmoSettings () { this.gizmoController.updateGizmoSettings(); }
	createGroup (name, objectIds) { this.groupManager.createGroup(name, objectIds); }
	deleteGroup (groupId) { this.groupManager.deleteGroup(groupId); }
	renameGroup (groupId, newName) { this.groupManager.renameGroup(groupId, newName); }
	getGroupOfObject (objectId) { return this.groupManager.getGroupOfObject(objectId); }
	alignSelection (axis, mode) { this.alignmentManager.alignSelection(axis, mode); }
	snapSelection (axis, margin) { this.alignmentManager.snapSelection(axis, margin); }
	updateObjectProperty (id, prop, value) { this.propertyManager.updateObjectProperty(id, prop, value); }
	updateMultipleObjectsProperty (prop, value) { this.propertyManager.updateMultipleObjectsProperty(prop, value); }
	updateGroupTransform (prop, values) { this.propertyManager.updateGroupTransform(prop, values); }
	updateObjectTransform (id, data) { this.propertyManager.updateObjectTransform(id, data); }
	toggleObjectVisibility (id) {
		const obj = this.placedObjects.find(o => o.id === id);
		if (obj) {
			const newState = obj.isVisible === undefined ? false : !obj.isVisible;
			this.propertyManager.updateVisibility(id, newState);
		}
	}
	toggleGroupVisibility (groupId) {
		const group = this.groups.find(g => g.id === groupId);
		if (group) {
			const anyVisible = group.objectIds.some(id => {
				const obj = this.placedObjects.find(o => o.id === id);
				return obj && (obj.isVisible !== false);
			});
			this.propertyManager.updateVisibilityBatch(group.objectIds, !anyVisible);
		}
	}
	deleteSelected () { this.operationManager.deleteSelected(); }
	duplicateSelection () { this.operationManager.duplicateSelection(); }
	setAnchor (mesh) { this.snapManager.setAnchor(mesh); }
	releaseAnchor () { this.snapManager.clearAnchor(); }

	// --- Asset Store Logic ---

	async addAssetToStore (name, file, thumbnail) {
		await this.assetManager.addToStore(name, file, thumbnail);
		if (this.onStoreChange) this.onStoreChange();
	}

	setActiveAsset (assetName) {
		if (this.activeAssetName === assetName || assetName === null) {
			this.activeAssetName = null;
			this.clearGhost();
		} else {
			this.activeAssetName = assetName;
			this.loadGhostAsset(assetName);
		}

		if (this.onAssetSelectionChange) {
			this.onAssetSelectionChange(this.activeAssetName);
		}
	}

	// --- Ghost Logic ---
	loadGhostAsset (assetName) {
		this.clearGhost();

		// Get template from store
		const newRoot = this.assetManager.instantiate(assetName);
		if (!newRoot) return;

		this.ghostMesh = newRoot;
		this.ghostMesh.name = "ghost_asset";

		// Configure ghost appearance
		this.ghostMesh.computeWorldMatrix(true);
		const descendants = this.ghostMesh.getChildMeshes(false);
		descendants.push(this.ghostMesh);

		descendants.forEach(m => {
			m.isPickable = false;
			m.checkCollisions = false;
			m.visibility = 0.5;
			m.receiveShadows = false;
			if (!m.metadata) m.metadata = {};
			m.metadata.isGhost = true;
		});

		const bounds = this.ghostMesh.getHierarchyBoundingVectors();
		this.ghostOffset = -bounds.min.y;

		this.ghostBoundsLocal = {
			min: bounds.min.clone(),
			max: bounds.max.clone()
		};

		this.ghostMesh.position = new BABYLON.Vector3(0, -1000, 0);

		this.updateGhostTransformFromSelection();
	}

	clearGhost () {
		if (this.ghostMesh) {
			// FIX: Do not dispose materials/textures (pass false as second arg)
			// because they are shared with placed objects (clones/instances).
			this.ghostMesh.dispose(false, false);
			this.ghostMesh = null;
		}
	}

	updateGhostTransformFromSelection () {
		if (!this.ghostMesh || !this.activeAssetName) return;

		let shouldCopy = false;
		let sourceMesh = null;

		if (this.selectedMeshes.length === 1) {
			const mesh = this.selectedMeshes[0];
			const objData = this.placedObjects.find(o => o.id === mesh.metadata.id);
			if (objData && objData.assetName === this.activeAssetName) {
				shouldCopy = true;
				sourceMesh = mesh;
			}
		}

		if (shouldCopy && sourceMesh) {
			if (!this.ghostMesh.rotationQuaternion) {
				this.ghostMesh.rotationQuaternion = new BABYLON.Quaternion();
			}
			if (sourceMesh.rotationQuaternion) {
				this.ghostMesh.rotationQuaternion.copyFrom(sourceMesh.rotationQuaternion);
			} else {
				BABYLON.Quaternion.FromEulerVectorToRef(sourceMesh.rotation, this.ghostMesh.rotationQuaternion);
			}
			this.ghostMesh.scaling.copyFrom(sourceMesh.scaling);
		} else {
			if (this.ghostMesh.rotationQuaternion) {
				this.ghostMesh.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
			} else {
				this.ghostMesh.rotation.set(0, 0, 0);
			}
			this.ghostMesh.scaling.set(1, 1, 1);
		}
	}

	updateGhostPosition (pickInfo) {
		if (!this.ghostMesh || !pickInfo.hit) return;

		let targetPos = pickInfo.pickedPoint.clone();
		let isStacked = false;

		if (pickInfo.pickedMesh && pickInfo.pickedMesh.name !== 'ground') {
			let mesh = pickInfo.pickedMesh;
			while (mesh && (!mesh.metadata || !mesh.metadata.isObject) && mesh.parent) {
				mesh = mesh.parent;
			}

			if (mesh) {
				mesh.computeWorldMatrix(true);
				const bounds = mesh.getHierarchyBoundingVectors();
				targetPos.y = bounds.max.y;
				isStacked = true;
			}
		}

		targetPos.y += this.ghostOffset;
		if (!isStacked) {
			targetPos.y += this.defaultYOffset;
		}

		let snapTargets = [];
		if (this.snapManager.anchorMesh) {
			snapTargets = [this.snapManager.anchorMesh];
		} else if (this.selectedMeshes.length > 0) {
			snapTargets = this.selectedMeshes;
		}

		if (snapTargets.length > 0 && this.ghostBoundsLocal) {
			const snapOffset = this.snapManager.calculateSnapOffset(
				targetPos,
				this.ghostBoundsLocal,
				this.ghostMesh.rotationQuaternion || BABYLON.Quaternion.FromEulerVector(this.ghostMesh.rotation),
				this.ghostMesh.scaling,
				snapTargets
			);

			if (snapOffset) {
				targetPos.x += snapOffset.x;
				targetPos.y += snapOffset.y;
				targetPos.z += snapOffset.z;
			}
		}

		this.ghostMesh.position = targetPos;
		this.ghostPosition = targetPos;
	}

	nudgeSelection (x, y, z) {
		if (this.selectedMeshes.length === 0) return;

		const changes = [];
		const offset = new BABYLON.Vector3(x, y, z);

		this.selectedMeshes.forEach(mesh => {
			const id = mesh.metadata.id;
			const objData = this.placedObjects.find(o => o.id === id);
			if (objData && objData.isLocked) return;

			const oldData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};

			mesh.position.addInPlace(offset);
			mesh.computeWorldMatrix(true);

			const newData = {
				position: mesh.absolutePosition.asArray(),
				rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
				scaling: mesh.absoluteScaling.asArray()
			};

			if (objData) {
				objData.position = newData.position;
			}

			changes.push({
				id: id,
				oldData: oldData,
				newData: newData
			});
		});

		if (changes.length > 0) {
			this.undoRedo.add({
				type: 'TRANSFORM',
				data: changes
			});

			this.updateSelectionProxy();

			if (this.onSelectionChange) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			}
		}
	}

	// --- Add Asset ---
	async addAsset (assetName, explicitPosition = null) {
		try {
			// Instantiate from store
			const root = this.assetManager.instantiate(assetName);
			if (!root) return;

			let targetX = 0;
			let targetZ = 0;
			let baseY = 0;
			let useExplicit = false;

			if (explicitPosition) {
				targetX = explicitPosition.x;
				baseY = explicitPosition.y;
				targetZ = explicitPosition.z;
				useExplicit = true;
			} else {
				if (this.selectedMeshes.length === 1) {
					const baseMesh = this.selectedMeshes[0];
					const bounds = baseMesh.getHierarchyBoundingVectors();
					targetX = (bounds.min.x + bounds.max.x) / 2;
					targetZ = (bounds.min.z + bounds.max.z) / 2;
					baseY = bounds.max.y;
				}
			}

			const id = BABYLON.Tools.RandomId();
			const existing = this.placedObjects.filter(o => o.name && o.name.startsWith(assetName));

			let maxIndex = 0;
			existing.forEach(o => {
				const parts = o.name.split('_');
				const suffix = parseInt(parts[parts.length - 1]);
				if (!isNaN(suffix) && suffix > maxIndex) {
					maxIndex = suffix;
				}
			});

			const uniqueName = `${assetName}_${maxIndex + 1}`;
			root.name = uniqueName;

			root.computeWorldMatrix(true);

			// Copy transforms from ghost if active
			if (this.ghostMesh && this.activeAssetName === assetName) {
				this.updateGhostTransformFromSelection();
				if (!root.rotationQuaternion) root.rotationQuaternion = new BABYLON.Quaternion();

				if (this.ghostMesh.rotationQuaternion) {
					root.rotationQuaternion.copyFrom(this.ghostMesh.rotationQuaternion);
				} else {
					BABYLON.Quaternion.FromEulerVectorToRef(this.ghostMesh.rotation, root.rotationQuaternion);
				}
				root.scaling.copyFrom(this.ghostMesh.scaling);
				root.computeWorldMatrix(true);
			}

			if (useExplicit) {
				root.position = new BABYLON.Vector3(targetX, baseY, targetZ);
			} else {
				const bounds = root.getHierarchyBoundingVectors();
				const heightOffset = -bounds.min.y;
				root.position = new BABYLON.Vector3(targetX, baseY + heightOffset + this.defaultYOffset, targetZ);
			}

			root.metadata = { id: id, isObject: true, assetName: assetName };

			const descendants = root.getChildMeshes(false);
			descendants.push(root);

			descendants.forEach(m => {
				// Register shadow caster (handle Instances)
				if (m instanceof BABYLON.InstancedMesh) {
					this.builderScene.registerShadowCaster(m.sourceMesh);
				} else {
					this.builderScene.registerShadowCaster(m);
				}

				m.receiveShadows = true;
				m.isPickable = true;
				if (m !== root) m.parent = root;
			});

			const objData = {
				id: id,
				name: uniqueName,
				assetName: assetName,
				type: 'mesh',
				isLocked: false,
				color: null,
				position: root.position.asArray(),
				rotation: root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().asArray() : root.rotation.asArray(),
				scaling: root.scaling.asArray()
			};

			this.placedObjects.push(objData);
			this.selectObject(root, false);

			if (this.snapManager.anchorMesh) {
				this.snapManager.setAnchor(root);
			}

			this.undoRedo.add({ type: 'ADD', data: [objData] });
			if (this.onListChange) this.onListChange();
		} catch (err) {
			console.error('Error adding asset:', err);
		}
	}

	// --- Add Grid (Optimized for Instances) ---
	async addAssetGrid (assetName, position, rows, cols) {
		try {
			// Create first instance/clone to serve as a template for the grid
			const root = this.assetManager.instantiate(assetName);
			if (!root) return;

			const bounds = root.getHierarchyBoundingVectors();
			const width = bounds.max.x - bounds.min.x;
			const depth = bounds.max.z - bounds.min.z;
			const heightOffset = -bounds.min.y;

			const addedObjectsData = [];
			const startX = position.x - (width * cols) / 2 + width / 2;
			const startZ = position.z - (depth * rows) / 2 + depth / 2;

			// Pre-register shadow casters for the source mesh once
			// This avoids 900x calls to registerShadowCaster which iterates all shadow generators
			const descendants = root.getChildMeshes(false);
			if (root instanceof BABYLON.Mesh) descendants.push(root);

			descendants.forEach(m => {
				if (m instanceof BABYLON.InstancedMesh) {
					this.builderScene.registerShadowCaster(m.sourceMesh);
				} else {
					this.builderScene.registerShadowCaster(m);
				}
			});

			const setupMesh = (mesh, r, c) => {
				const id = BABYLON.Tools.RandomId();
				const existingCount = this.placedObjects.filter(o => o.name && o.name.startsWith(assetName)).length + addedObjectsData.length;
				const uniqueName = `${assetName}_${existingCount + 1}`;

				mesh.name = uniqueName;
				mesh.position = new BABYLON.Vector3(
					startX + c * width,
					position.y + heightOffset + this.defaultYOffset,
					startZ + r * depth
				);

				mesh.metadata = { id: id, isObject: true, assetName: assetName };

				// Configure children (picking, shadows)
				// We already registered shadow casters for the source above
				const meshDescendants = mesh.getChildMeshes(false);
				if (mesh instanceof BABYLON.Mesh) meshDescendants.push(mesh);

				meshDescendants.forEach(m => {
					m.receiveShadows = true;
					m.isPickable = true;
				});

				const objData = {
					id: id,
					name: uniqueName,
					assetName: assetName,
					type: 'mesh',
					isLocked: false,
					isVisible: true,
					color: null,
					position: mesh.position.asArray(),
					rotation: mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().asArray() : mesh.rotation.asArray(),
					scaling: mesh.scaling.asArray()
				};

				this.placedObjects.push(objData);
				addedObjectsData.push(objData);
				return mesh;
			};

			// Setup the first one
			setupMesh(root, 0, 0);

			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					if (r === 0 && c === 0) continue;

					// Instantiate a new instance from the AssetManager
					// This ensures we get a clean instance/clone from the source template
					// Cloning the 'root' instance works too, but using assetManager is safer for structure
					const clone = this.assetManager.instantiate(assetName);

					setupMesh(clone, r, c);
				}
			}

			this.selectedMeshes = [];
			// Select all added objects? Maybe too many. Select just the last one or none.
			// Selecting 900 objects might lag the properties panel.
			// Let's select none to be safe.
			this.selectObject(null, false);

			this.undoRedo.add({ type: 'ADD', data: addedObjectsData });

			// Create a new group for the grid
			const objectIds = addedObjectsData.map(o => o.id);
			const baseGroupName = `${assetName}_grid`;
			let groupIndex = 1;

			// Find unique name
			while (this.groups.some(g => g.name === `${baseGroupName}_${groupIndex}`)) {
				groupIndex++;
			}
			const groupName = `${baseGroupName}_${groupIndex}`;

			// createGroup handles selection of the group items
			this.createGroup(groupName, objectIds);

			if (this.onListChange) this.onListChange();
		} catch (e) {
			console.error('Grid spawn error:', e);
		}
	}

	addLight (type = 'point', position = null) {
		const pos = position || this.builderScene.selectedCellPosition || new BABYLON.Vector3(0, 5, 0);
		const id = BABYLON.Tools.RandomId();
		const existingLights = this.placedObjects.filter(o => o.type === 'light');
		const name = `Light_${type}_${existingLights.length + 1}`;

		const { mesh, light } = this.lightManager.createLight(type, new BABYLON.Vector3(pos.x, pos.y + 5, pos.z), name);

		mesh.metadata = { id: id, isObject: true, type: 'light', kind: type };

		const objData = {
			id: id,
			name: name,
			type: 'light',
			kind: type,
			isLocked: false,
			isVisible: true,
			color: light.diffuse.toHexString(),
			specularColor: light.specular.toHexString(),
			groundColor: (type === 'hemispheric') ? light.groundColor.toHexString() : null,
			position: mesh.position.asArray(),
			rotation: mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().asArray() : mesh.rotation.asArray(),
			scaling: [1, 1, 1],
			intensity: light.intensity,
			castShadows: false,
			direction: (type !== 'point') ? [light.direction.x, light.direction.y, light.direction.z] : null
		};

		this.placedObjects.push(objData);
		this.selectObject(mesh, false);
		this.undoRedo.add({ type: 'ADD', data: [objData] });
		if (this.onListChange) this.onListChange();
	}

	removeObjectById (id, clearSelection = true) {
		const mesh = this.findMeshById(id);
		if (mesh && this.snapManager.anchorMesh === mesh) {
			this.snapManager.clearAnchor();
		}

		if (mesh) {
			if (mesh.metadata && mesh.metadata.type !== 'light') {
				const descendants = mesh.getChildMeshes(false);
				descendants.push(mesh);
				descendants.forEach(m => this.builderScene.unregisterShadowCaster(m));
			}

			if (mesh.metadata && mesh.metadata.type === 'light') {
				this.builderScene.disableShadows(id);
			}

			if (clearSelection) {
				this.selectedMeshes = this.selectedMeshes.filter(m => m !== mesh);
				this.updateSelectionProxy();
			}
			mesh.dispose();
		}

		this.placedObjects = this.placedObjects.filter(o => o && o.id !== id);
	}

	createDefaultMainLightData () {
		return {
			id: 'main_sun',
			name: 'Sun',
			type: 'light',
			kind: 'directional',
			isLocked: false,
			isVisible: true,
			color: '#ffffff',
			specularColor: '#ffffff',
			position: [20, 40, 20],
			direction: [-1, -2, -1],
			rotation: [0, 0, 0],
			scaling: [1, 1, 1],
			intensity: 1.0,
			castShadows: true
		};
	}

	createDefaultAmbientLightData () {
		return {
			id: 'ambient_sky',
			name: 'Ambient Sky',
			type: 'light',
			kind: 'hemispheric',
			isLocked: false,
			isVisible: true,
			color: '#ffffff',
			specularColor: '#000000',
			groundColor: '#333333',
			position: [0, 10, 0],
			direction: [0, 1, 0],
			rotation: [0, 0, 0],
			scaling: [1, 1, 1],
			intensity: 0.7,
			castShadows: false
		};
	}

	async restoreObject (data) {
		if (data.type === 'light') {
			const { mesh, light } = this.lightManager.createLight(data.kind, BABYLON.Vector3.FromArray(data.position), data.name);
			mesh.metadata = { id: data.id, isObject: true, type: 'light', kind: data.kind };

			if (data.scaling) mesh.scaling = BABYLON.Vector3.FromArray(data.scaling);

			if (data.rotation) {
				const rot = BABYLON.Vector3.FromArray(data.rotation);
				if (mesh.rotationQuaternion) {
					mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(rot);
				} else {
					mesh.rotation = rot;
				}
			}

			this.lightManager.updateLightProperties(mesh, data);

			if (data.castShadows) this.builderScene.enableShadows(mesh);
			if (data.isVisible === false) mesh.setEnabled(false);

			this.placedObjects.push(data);
			if (this.onListChange) this.onListChange();
			return Promise.resolve();

		} else {
			// Mesh Object
			const assetName = data.assetName;

			const root = this.assetManager.instantiate(assetName);
			if (!root) {
				console.warn(`Skipping object ${data.name}: Asset '${assetName}' not found in store.`);
				return;
			}

			root.name = data.name;
			root.position = BABYLON.Vector3.FromArray(data.position);
			root.rotation = BABYLON.Vector3.FromArray(data.rotation);
			root.scaling = BABYLON.Vector3.FromArray(data.scaling);
			root.metadata = { id: data.id, isObject: true, assetName: assetName };

			if (data.isVisible === false) root.setEnabled(false);

			const descendants = root.getChildMeshes(false);
			descendants.push(root);

			descendants.forEach(m => {
				if (m instanceof BABYLON.InstancedMesh) {
					this.builderScene.registerShadowCaster(m.sourceMesh);
				} else {
					this.builderScene.registerShadowCaster(m);
				}

				m.receiveShadows = true;
				m.isPickable = true;
				if (m !== root) m.parent = root;
			});

			this.placedObjects.push(data);
			if (this.onListChange) this.onListChange();
		}
	}

	selectObjectsByIds (ids) {
		this.selectObject(null, false);
		const meshesToSelect = [];
		ids.forEach(id => {
			const mesh = this.findMeshById(id);
			if (mesh) {
				meshesToSelect.push(mesh);
			}
		});

		if (meshesToSelect.length > 0) {
			this.selectObject(meshesToSelect[0], false);
			for (let i = 1; i < meshesToSelect.length; i++) {
				this.selectObject(meshesToSelect[i], true);
			}
		}
	}

	selectObject (mesh, isMultiSelect) {
		if (mesh && mesh.parent && mesh.parent.metadata && mesh.parent.metadata.isObject) {
			mesh = mesh.parent;
		}

		if (!isMultiSelect) {
			this.selectedMeshes.forEach(m => this.setSelectionHighlight(m, false));
			this.selectedMeshes = [];

			if (mesh) {
				this.selectedMeshes.push(mesh);
				this.setSelectionHighlight(mesh, true);
			}
		} else {
			if (mesh) {
				const index = this.selectedMeshes.indexOf(mesh);
				if (index !== -1) {
					this.setSelectionHighlight(mesh, false);
					this.selectedMeshes.splice(index, 1);
				} else {
					this.selectedMeshes.push(mesh);
					this.setSelectionHighlight(mesh, true);
				}
			}
		}

		this.updateSelectionProxy();
		this.updateGhostTransformFromSelection();

		if (this.onSelectionChange) {
			if (this.selectedMeshes.length > 0) {
				const selectedData = this.selectedMeshes.map(m => this.placedObjects.find(o => o.id === m.metadata.id));
				this.onSelectionChange(selectedData);
			} else {
				this.onSelectionChange(null);
			}
		}
	}

	updateSelectionProxy () {
		if (this.selectionProxy) {
			const children = this.selectionProxy.getChildren();
			children.forEach(c => c.setParent(null));

			this.gizmoController.attachToMesh(null);
			this.selectionProxy.dispose();
			this.selectionProxy = null;
		}

		if (this.selectedMeshes.length === 0) {
			this.gizmoController.attachToMesh(null);
			return;
		}

		const allLocked = this.selectedMeshes.every(m => {
			const data = this.placedObjects.find(o => o.id === m.metadata.id);
			return data && data.isLocked;
		});

		if (allLocked) {
			this.gizmoController.attachToMesh(null);
			return;
		}

		if (this.selectedMeshes.length === 1) {
			this.gizmoController.attachToMesh(this.selectedMeshes[0]);
		} else {
			this.selectionProxy = new BABYLON.TransformNode('selectionProxy', this.scene);

			let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
			let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

			this.selectedMeshes.forEach(m => {
				const bounds = m.getHierarchyBoundingVectors();
				min = BABYLON.Vector3.Minimize(min, bounds.min);
				max = BABYLON.Vector3.Maximize(max, bounds.max);
			});

			const center = min.add(max).scale(0.5);
			this.selectionProxy.position = center;

			this.selectedMeshes.forEach(m => m.setParent(this.selectionProxy));
			this.gizmoController.attachToMesh(this.selectionProxy);
		}
	}

	setSelectionHighlight (mesh, isSelected) {
		const children = mesh.getChildMeshes(false);
		children.forEach(m => {
			m.showBoundingBox = isSelected;
		});
		mesh.showBoundingBox = isSelected;
	}

	findMeshById (id) {
		return this.scene.meshes.find(m => m.metadata && m.metadata.id === id) ||
			this.scene.lights.find(l => l.metadata && l.metadata.id === id);
	}

	getMapData (mapName) {
		// Get all assets currently in the store
		const storeDefinitions = this.assetManager.getAllAssets();

		return {
			name: mapName,
			version: 3,
			assetStore: storeDefinitions,
			assets: this.placedObjects,
			groups: this.groups
		};
	}

	async loadMapData (data) {
		this.snapManager.clearAnchor();

		[...this.scene.meshes].forEach(m => {
			if (m.metadata && m.metadata.isObject) m.dispose();
		});
		[...this.scene.lights].forEach(l => {
			if (l.metadata && l.metadata.isObject) l.dispose();
		});

		this.placedObjects = [];
		this.groups = data.groups || [];
		this.selectedMeshes = [];
		this.undoRedo.history = [];
		this.undoRedo.historyIndex = -1;
		if (this.undoRedo.onHistoryChange) this.undoRedo.onHistoryChange();

		this.selectObject(null, false);

		// 1. Restore Asset Store
		this.assetManager.clear();
		if (data.assetStore) {
			for (const def of data.assetStore) {
				await this.assetManager.addToStore(def.name, def.file, def.thumbnail);
			}
			if (this.onStoreChange) this.onStoreChange();
		}

		if (this.onListChange) this.onListChange();

		if (data.assets && data.assets.length > 0) {
			const promises = data.assets.map(item => this.restoreObject(item));
			await Promise.all(promises);
		} else {
			const defaultSun = this.createDefaultMainLightData();
			const defaultAmbient = this.createDefaultAmbientLightData();
			await this.restoreObject(defaultSun);
			await this.restoreObject(defaultAmbient);
		}
	}

	clearScene () {
		const currentStore = this.assetManager.getAllAssets();
		this.loadMapData({ assetStore: currentStore, assets: [], groups: [] });
	}

	saveToAutoSave () {
		if (!this.autoSaveEnabled) return false;
		const data = this.getMapData('autosave');
		localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(data));

		const selectedIds = this.selectedMeshes.map(m => m.metadata.id);
		localStorage.setItem(LS_SELECTION_KEY, JSON.stringify(selectedIds));

		return true;
	}

	async loadFromAutoSave () {
		const saved = localStorage.getItem(LS_AUTOSAVE_KEY);
		if (saved) {
			try {
				const data = JSON.parse(saved);
				console.log('Restoring auto-saved map...');
				await this.loadMapData(data);

				const savedSelection = localStorage.getItem(LS_SELECTION_KEY);
				if (savedSelection) {
					try {
						const ids = JSON.parse(savedSelection);
						if (Array.isArray(ids) && ids.length > 0) {
							this.selectObjectsByIds(ids);
						}
					} catch (e) {
						console.error('Failed to load selection state', e);
					}
				}

			} catch (e) {
				console.error('Failed to load auto-save', e);
			}
		} else {
			this.loadMapData({ assets: [], groups: [] });
		}
	}
}