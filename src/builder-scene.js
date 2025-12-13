import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { loadAssets } from './loader';

const ASSET_FOLDER = './assets/nature/';

export class BuilderScene {
	constructor (canvas) {
		this.canvas = canvas;
		this.engine = null;
		this.scene = null;
		this.camera = null;
		this.shadowGenerator = null;
		this.groundMesh = null;
		this.cursorMesh = null;
		
		// State
		this.placedObjects = [];
		this.currentGridSize = 5;
		this.selectedCellPosition = new BABYLON.Vector3(0, 0, 0);
		
		// Interaction
		this.draggedMesh = null;
		this.isDragging = false;
		this.startingDragPosition = null;
	}
	
	async init () {
		// 1. Engine
		this.engine = new BABYLON.Engine(this.canvas, true, {
			disableWebGL2Support: false,
			useHighPrecisionMatrix: true,
			preserveDrawingBuffer: true,
			stencil: true
		});
		
		// 2. Scene
		this.scene = new BABYLON.Scene(this.engine);
		
		// 3. Camera - ArcRotateCamera for Editor Style (Right click pan, Scroll zoom)
		this.camera = new BABYLON.ArcRotateCamera('EditorCamera', -Math.PI / 2, Math.PI / 3, 50, BABYLON.Vector3.Zero(), this.scene);
		this.camera.attachControl(this.canvas, true);
		this.camera.wheelPrecision = 50; // Adjust zoom speed
		this.camera.panningSensibility = 50; // Adjust pan speed
		this.camera.useCtrlForPanning = false; // Right click pans without CTRL
		this.camera.lowerRadiusLimit = 2;
		this.camera.upperRadiusLimit = 200;
		
		// 4. Lights
		const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), this.scene);
		hemiLight.intensity = 0.7;
		
		const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-1, -2, -1), this.scene);
		dirLight.position = new BABYLON.Vector3(20, 40, 20);
		dirLight.intensity = 0.8;
		
		this.shadowGenerator = new BABYLON.ShadowGenerator(2048, dirLight);
		this.shadowGenerator.useBlurExponentialShadowMap = true;
		
		// 5. Grid & Cursor
		this.createGrid(this.currentGridSize);
		this.createCursor();
		
		// 6. Interaction
		this.setupInteraction();
		
		// 7. Render Loop
		this.engine.runRenderLoop(() => {
			this.scene.render();
		});
		
		window.addEventListener('resize', () => {
			this.engine.resize();
		});
		
		// Load Assets list
		return await loadAssets(this.engine);
	}
	
	createGrid (gridSize) {
		const width = 200;
		const height = 200;
		const textureResolution = 2048;
		
		if (!this.groundMesh) {
			this.groundMesh = BABYLON.MeshBuilder.CreateGround('ground', { width: width, height: height }, this.scene);
			this.groundMesh.receiveShadows = true;
			this.groundMesh.isPickable = true;
			
			const gridTexture = new BABYLON.DynamicTexture('gridTex', textureResolution, this.scene, true);
			const mat = new BABYLON.StandardMaterial('gridMat', this.scene);
			mat.diffuseTexture = gridTexture;
			mat.specularColor = new BABYLON.Color3(0, 0, 0);
			this.groundMesh.material = mat;
		}
		
		const gridTexture = this.groundMesh.material.diffuseTexture;
		const ctx = gridTexture.getContext();
		
		// Background
		const gradient = ctx.createLinearGradient(0, 0, 0, textureResolution);
		gradient.addColorStop(0, '#1a1a1a');
		gradient.addColorStop(1, '#2c3e50');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, textureResolution, textureResolution);
		
		// Grid Lines
		ctx.strokeStyle = '#555555';
		ctx.lineWidth = 2;
		
		// Calculate lines aligned to World (0,0)
		// Map extends from -width/2 to +width/2
		const minX = -width / 2;
		const minZ = -height / 2;
		
		// Pixels per unit
		const pixelsPerUnit = textureResolution / width;
		
		// Draw Vertical Lines (X steps)
		// Find first multiple of gridSize >= minX
		const startX = Math.ceil(minX / gridSize) * gridSize;
		
		for (let x = startX; x <= width / 2; x += gridSize) {
			// Convert world X to texture X
			const textureX = (x - minX) * pixelsPerUnit;
			ctx.beginPath();
			ctx.moveTo(textureX, 0);
			ctx.lineTo(textureX, textureResolution);
			ctx.stroke();
		}
		
		// Draw Horizontal Lines (Z steps)
		const startZ = Math.ceil(minZ / gridSize) * gridSize;
		
		for (let z = startZ; z <= height / 2; z += gridSize) {
			// World Z to Texture Y
			const textureY = (z - minZ) * pixelsPerUnit;
			ctx.beginPath();
			ctx.moveTo(0, textureY);
			ctx.lineTo(textureResolution, textureY);
			ctx.stroke();
		}
		
		gridTexture.update();
	}
	
	createCursor () {
		// A visual indicator for the selected grid cell
		// Create slightly smaller than grid size to avoid z-fighting with lines
		const size = this.currentGridSize * 0.95;
		this.cursorMesh = BABYLON.MeshBuilder.CreateGround('cursor', { width: size, height: size }, this.scene);
		const mat = new BABYLON.StandardMaterial('cursorMat', this.scene);
		mat.diffuseColor = new BABYLON.Color3(0, 1, 0);
		mat.alpha = 0.4;
		mat.zOffset = -1; // Ensure it renders above ground
		this.cursorMesh.material = mat;
		this.cursorMesh.isPickable = false;
		
		// Initialize at 0,0 (or nearest cell center)
		this.updateCursorPosition(new BABYLON.Vector3(0, 0, 0));
	}
	
	updateGridSize (size) {
		this.currentGridSize = size;
		this.createGrid(size);
		// Update cursor size
		this.cursorMesh.dispose();
		this.createCursor();
	}
	
	updateCursorPosition (point) {
		// Snap to center of the cell
		const x = Math.floor(point.x / this.currentGridSize) * this.currentGridSize + this.currentGridSize / 2;
		const z = Math.floor(point.z / this.currentGridSize) * this.currentGridSize + this.currentGridSize / 2;
		this.selectedCellPosition.set(x, 0, z);
		this.cursorMesh.position.set(x, 0.05, z);
	}
	
	setupInteraction () {
		this.scene.onPointerObservable.add((pointerInfo) => {
			switch (pointerInfo.type) {
				case BABYLON.PointerEventTypes.POINTERDOWN:
					this.handlePointerDown(pointerInfo);
					break;
				case BABYLON.PointerEventTypes.POINTERUP:
					this.handlePointerUp(pointerInfo);
					break;
				case BABYLON.PointerEventTypes.POINTERMOVE:
					this.handlePointerMove(pointerInfo);
					break;
				case BABYLON.PointerEventTypes.POINTERDOUBLETAP:
					this.handleDoubleClick(pointerInfo);
					break;
			}
		});
	}
	
	handlePointerMove (info) {
		// Only handle dragging here. Cursor update is now on Click (PointerDown).
		if (this.isDragging && this.draggedMesh) {
			const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.groundMesh);
			if (groundPick.hit) {
				const targetPos = groundPick.pickedPoint.clone();
				targetPos.y = this.draggedMesh.position.y;
				const snappedPos = this.calculateMagneticSnap(this.draggedMesh, targetPos);
				this.draggedMesh.position = snappedPos;
			}
		}
	}
	
	handlePointerDown (info) {
		const pickResult = info.pickInfo;
		
		// 1. Handle Grid Selection (Clicking Ground)
		if (pickResult.hit && pickResult.pickedMesh === this.groundMesh) {
			this.updateCursorPosition(pickResult.pickedPoint);
			return; // Stop processing if we just clicked the ground
		}
		
		// 2. Handle Object Selection (Dragging)
		if (pickResult.hit && pickResult.pickedMesh !== this.groundMesh) {
			let mesh = pickResult.pickedMesh;
			while (mesh && !mesh.name.startsWith('obj_') && !mesh.name.startsWith('pointLight_') && mesh.parent) {
				mesh = mesh.parent;
			}
			
			if (mesh && (mesh.name.startsWith('obj_') || mesh.name.startsWith('pointLight_'))) {
				this.draggedMesh = mesh;
				this.isDragging = true;
				this.startingDragPosition = mesh.position.clone();
				this.camera.detachControl();
			}
		}
	}
	
	handlePointerUp (info) {
		if (this.isDragging) {
			if (this.draggedMesh) {
				this.updatePlacedObjectData(this.draggedMesh);
			}
			this.isDragging = false;
			this.draggedMesh = null;
			this.camera.attachControl(this.canvas, true);
		}
	}
	
	handleDoubleClick (info) {
		if (info.pickInfo.hit && info.pickInfo.pickedMesh !== this.groundMesh) {
			let mesh = info.pickInfo.pickedMesh;
			while (mesh.parent && !mesh.name.startsWith('obj_')) {
				mesh = mesh.parent;
			}
			
			// Animate Camera Focus
			const targetPos = mesh.position.clone();
			const radius = 10;
			BABYLON.Animation.CreateAndStartAnimation('camTarget', this.camera, 'target', 60, 30, this.camera.target, targetPos, 0);
			BABYLON.Animation.CreateAndStartAnimation('camRadius', this.camera, 'radius', 60, 30, this.camera.radius, radius, 0);
		}
	}
	
	calculateMagneticSnap (mesh, targetPos) {
		mesh.computeWorldMatrix(true);
		const bounds = mesh.getHierarchyBoundingVectors();
		const size = bounds.max.subtract(bounds.min);
		const halfSize = size.scale(0.5);
		
		const proposedMin = targetPos.subtract(halfSize);
		const proposedMax = targetPos.add(halfSize);
		
		let finalPos = targetPos.clone();
		const snapThreshold = 1.0;
		
		this.scene.meshes.forEach(other => {
			if (other === mesh || other === this.groundMesh || other === this.cursorMesh || !other.name.startsWith('obj_')) return;
			
			other.computeWorldMatrix(true);
			const otherBounds = other.getHierarchyBoundingVectors();
			
			if (Math.abs(otherBounds.max.x - proposedMin.x) < snapThreshold) {
				finalPos.x = otherBounds.max.x + halfSize.x;
			} else if (Math.abs(otherBounds.min.x - proposedMax.x) < snapThreshold) {
				finalPos.x = otherBounds.min.x - halfSize.x;
			}
			
			if (Math.abs(otherBounds.max.z - proposedMin.z) < snapThreshold) {
				finalPos.z = otherBounds.max.z + halfSize.z;
			} else if (Math.abs(otherBounds.min.z - proposedMax.z) < snapThreshold) {
				finalPos.z = otherBounds.min.z - halfSize.z;
			}
		});
		
		return finalPos;
	}
	
	async addAssetAtCursor (filename) {
		if (!filename) return;
		
		const position = this.selectedCellPosition.clone();
		
		// Simple check if position is exactly occupied by another object's origin
		const isOccupied = this.placedObjects.some(obj => {
			const objPos = BABYLON.Vector3.FromArray(obj.position);
			return BABYLON.Vector3.Distance(objPos, position) < 0.1;
		});
		
		if (isOccupied) {
			console.log('Cell occupied, stacking or ignoring...');
		}
		
		try {
			const result = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, filename, this.scene);
			const root = result.meshes[0];
			
			const bounds = root.getHierarchyBoundingVectors();
			const heightOffset = -bounds.min.y;
			
			const id = BABYLON.Tools.RandomId();
			root.name = 'obj_' + id;
			root.position = new BABYLON.Vector3(position.x, position.y + heightOffset, position.z);
			
			const metadata = {
				id: id,
				file: filename,
				position: root.position.asArray(),
				rotation: root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().asArray() : root.rotation.asArray(),
				scaling: root.scaling.asArray()
			};
			
			this.placedObjects.push(metadata);
			
			result.meshes.forEach(m => {
				this.shadowGenerator.addShadowCaster(m, true);
				m.receiveShadows = true;
				m.isPickable = true;
			});
			
		} catch (err) {
			console.error('Error adding asset:', err);
		}
	}
	
	addLightAtCursor () {
		const position = this.selectedCellPosition.clone();
		const id = 'pointLight_' + Date.now();
		const light = new BABYLON.PointLight(id, new BABYLON.Vector3(position.x, 5, position.z), this.scene);
		light.intensity = 0.5;
		
		const sphere = BABYLON.MeshBuilder.CreateSphere('lightGizmo', { diameter: 0.5 }, this.scene);
		sphere.position = light.position;
		sphere.material = new BABYLON.StandardMaterial('lm', this.scene);
		sphere.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
		sphere.setParent(light);
		sphere.isPickable = true;
		
		this.placedObjects.push({ type: 'light', id: id, position: light.position.asArray() });
	}
	
	updatePlacedObjectData (mesh) {
		let id = null;
		if (mesh.name.startsWith('obj_')) {
			id = mesh.name.substring(4);
		} else if (mesh.name.startsWith('pointLight_')) {
			id = mesh.name;
		}
		
		const obj = this.placedObjects.find(o => o.id === id || (o.type === 'light' && o.id === id));
		if (obj) {
			obj.position = mesh.position.asArray();
		}
	}
	
	getMapData (mapName) {
		return {
			name: mapName,
			version: 1,
			assets: this.placedObjects
		};
	}
	
	loadMapData (data) {
		const toDispose = this.scene.meshes.filter(m => m.name.startsWith('obj_') || m.name.startsWith('pointLight_'));
		const lightsToDispose = this.scene.lights.filter(l => l.name.startsWith('pointLight_'));
		toDispose.forEach(m => m.dispose());
		lightsToDispose.forEach(l => l.dispose());
		this.placedObjects = [];
		
		if (data.assets) {
			data.assets.forEach(item => {
				if (item.type === 'light') {
					const light = new BABYLON.PointLight(item.id, BABYLON.Vector3.FromArray(item.position), this.scene);
					light.intensity = 0.5;
					const sphere = BABYLON.MeshBuilder.CreateSphere('lightGizmo', { diameter: 0.5 }, this.scene);
					sphere.position = light.position;
					sphere.material = new BABYLON.StandardMaterial('lm', this.scene);
					sphere.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
					sphere.setParent(light);
					this.placedObjects.push(item);
				} else {
					BABYLON.SceneLoader.ImportMeshAsync('', ASSET_FOLDER, item.file, this.scene).then(res => {
						const root = res.meshes[0];
						root.name = 'obj_' + item.id;
						root.position = BABYLON.Vector3.FromArray(item.position);
						if (item.rotation) root.rotation = BABYLON.Vector3.FromArray(item.rotation);
						if (item.scaling) root.scaling = BABYLON.Vector3.FromArray(item.scaling);
						res.meshes.forEach(m => {
							this.shadowGenerator.addShadowCaster(m, true);
							m.receiveShadows = true;
							m.isPickable = true;
						});
						this.placedObjects.push(item);
					});
				}
			});
		}
	}
}
