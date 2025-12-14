import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { loadAssets } from './loader';
import { ObjectManager } from './object-manager';

export class BuilderScene {
	constructor (canvas) {
		this.canvas = canvas;
		this.engine = null;
		this.scene = null;
		this.camera = null;
		this.shadowGenerator = null;
		this.groundMesh = null;
		this.cursorMesh = null;
		
		this.objectManager = null;
		
		// Interaction State
		this.selectedCellPosition = new BABYLON.Vector3(0, 0, 0);
		this.isDragging = false;
		this.draggedMesh = null;
		this.dragOffset = new BABYLON.Vector3(0, 0, 0);
		
		// Visual Settings Defaults
		this.gridColor = '#555555';
		this.gridBgColor = '#2c3e50';
		
		// Input State
		this.isCtrlDown = false;
		this.isAltDown = false;
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
		
		// 3. Camera
		this.camera = new BABYLON.ArcRotateCamera('EditorCamera', -Math.PI / 2, Math.PI / 3, 50, BABYLON.Vector3.Zero(), this.scene);
		// Don't attach control immediately, wait for Key logic
		this.camera.wheelPrecision = 50;
		this.camera.panningSensibility = 50;
		this.camera.lowerRadiusLimit = 2;
		this.camera.upperRadiusLimit = 200;
		
		// --- Camera Input Configuration ---
		// We will toggle useCtrlForPanning dynamically in setupKeyboardControls
		// Default to false so standard attachControl uses Left Click for Orbit
		this.camera.useCtrlForPanning = false;
		
		// 4. Lights
		const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), this.scene);
		hemiLight.intensity = 0.7;
		
		const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-1, -2, -1), this.scene);
		dirLight.position = new BABYLON.Vector3(20, 40, 20);
		dirLight.intensity = 0.8;
		
		this.shadowGenerator = new BABYLON.ShadowGenerator(2048, dirLight);
		this.shadowGenerator.useBlurExponentialShadowMap = true;
		
		// 5. Object Manager (Handles Logic)
		this.objectManager = new ObjectManager(this.scene, this.shadowGenerator);
		
		// 6. Grid & Cursor (Created after settings are loaded in UI, but init here with defaults)
		this.createGrid(this.objectManager.gridSize);
		this.createCursor();
		
		// 7. Interaction
		this.setupInteraction();
		this.setupKeyboardControls();
		
		// 8. Render Loop
		this.engine.runRenderLoop(() => {
			this.scene.render();
		});
		
		window.addEventListener('resize', () => {
			this.engine.resize();
		});
		
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
		
		// Background (Canvas Background Color setting)
		const gradient = ctx.createLinearGradient(0, 0, 0, textureResolution);
		// Darken the bottom slightly for depth, but base it on the setting
		gradient.addColorStop(0, this.shadeColor(this.gridBgColor, -20));
		gradient.addColorStop(1, this.gridBgColor);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, textureResolution, textureResolution);
		
		// Grid Lines
		ctx.strokeStyle = this.gridColor;
		ctx.lineWidth = 1;
		
		const minX = -width / 2;
		const minZ = -height / 2;
		const pixelsPerUnit = textureResolution / width;
		
		// Draw Vertical
		const startX = Math.ceil(minX / gridSize) * gridSize;
		for (let x = startX; x <= width / 2; x += gridSize) {
			const textureX = (x - minX) * pixelsPerUnit;
			ctx.beginPath();
			ctx.moveTo(textureX, 0);
			ctx.lineTo(textureX, textureResolution);
			ctx.stroke();
		}
		
		// Draw Horizontal
		const startZ = Math.ceil(minZ / gridSize) * gridSize;
		for (let z = startZ; z <= height / 2; z += gridSize) {
			const textureY = (z - minZ) * pixelsPerUnit;
			ctx.beginPath();
			ctx.moveTo(0, textureY);
			ctx.lineTo(textureResolution, textureY);
			ctx.stroke();
		}
		
		gridTexture.update();
	}
	
	// Helper to darken/lighten hex color for gradient
	shadeColor(color, percent) {
		let R = parseInt(color.substring(1,3),16);
		let G = parseInt(color.substring(3,5),16);
		let B = parseInt(color.substring(5,7),16);
		
		R = parseInt(R * (100 + percent) / 100);
		G = parseInt(G * (100 + percent) / 100);
		B = parseInt(B * (100 + percent) / 100);
		
		R = (R<255)?R:255;
		G = (G<255)?G:255;
		B = (B<255)?B:255;
		
		const RR = ((R.toString(16).length===1)?"0"+R.toString(16):R.toString(16));
		const GG = ((G.toString(16).length===1)?"0"+G.toString(16):G.toString(16));
		const BB = ((B.toString(16).length===1)?"0"+B.toString(16):B.toString(16));
		
		return "#"+RR+GG+BB;
	}
	
	setGridColors (lineColor, bgColor) {
		this.gridColor = lineColor;
		this.gridBgColor = bgColor;
		// Re-render grid with new colors
		this.createGrid(this.objectManager.gridSize);
	}
	
	createCursor () {
		const size = this.objectManager.gridSize * 0.95;
		this.cursorMesh = BABYLON.MeshBuilder.CreateGround('cursor', { width: size, height: size }, this.scene);
		const mat = new BABYLON.StandardMaterial('cursorMat', this.scene);
		mat.diffuseColor = new BABYLON.Color3(0, 1, 0);
		mat.alpha = 0.4;
		mat.zOffset = -1;
		this.cursorMesh.material = mat;
		this.cursorMesh.isPickable = false;
		this.updateCursorPosition(new BABYLON.Vector3(0, 0, 0));
	}
	
	updateGridSize (size) {
		this.objectManager.gridSize = size;
		this.createGrid(size);
		this.cursorMesh.dispose();
		this.createCursor();
	}
	
	updateCursorPosition (point) {
		const gridSize = this.objectManager.gridSize;
		const x = Math.floor(point.x / gridSize) * gridSize + gridSize / 2;
		const z = Math.floor(point.z / gridSize) * gridSize + gridSize / 2;
		this.selectedCellPosition.set(x, 0, z);
		this.cursorMesh.position.set(x, 0.05, z);
	}
	
	setupKeyboardControls () {
		const updateCameraState = () => {
			// Always detach first to ensure clean state
			this.camera.detachControl();
			
			if (this.isCtrlDown) {
				// Ctrl + Left Click = Pan
				this.camera.useCtrlForPanning = true;
				this.camera.attachControl(this.canvas, true);
			} else if (this.isAltDown) {
				// Alt + Left Click = Orbit
				// We disable useCtrlForPanning, so Left Click maps to Orbit (default)
				this.camera.useCtrlForPanning = false;
				this.camera.attachControl(this.canvas, true);
			}
		};
		
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Control') {
				if (!this.isCtrlDown) {
					this.isCtrlDown = true;
					updateCameraState();
				}
			} else if (e.key === 'Alt') {
				if (!this.isAltDown) {
					this.isAltDown = true;
					e.preventDefault(); // Prevent browser menu focus
					updateCameraState();
				}
			}
		});
		
		window.addEventListener('keyup', (e) => {
			if (e.key === 'Control') {
				this.isCtrlDown = false;
				updateCameraState();
			} else if (e.key === 'Alt') {
				this.isAltDown = false;
				updateCameraState();
			}
		});
		
		// Ensure camera is detached initially
		this.camera.detachControl();
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
	
	handlePointerDown (info) {
		// If manipulating camera, do not select/drag objects
		if (this.isCtrlDown || this.isAltDown) return;
		
		const pick = info.pickInfo;
		const isMultiSelect = info.event.shiftKey;
		
		if (pick.hit) {
			// 1. Handle Grid Click (Deselect)
			if (pick.pickedMesh === this.groundMesh) {
				this.updateCursorPosition(pick.pickedPoint);
				// If clicking grid without shift, deselect all
				if (!isMultiSelect) {
					this.objectManager.selectObject(null, false);
				}
				return;
			}
			
			// 2. Handle Object Click
			let mesh = pick.pickedMesh;
			// Traverse up to find the root object with metadata
			while (mesh && (!mesh.metadata || !mesh.metadata.isObject) && mesh.parent) {
				mesh = mesh.parent;
			}
			
			if (mesh && mesh.metadata && mesh.metadata.isObject) {
				// Logic: Check if object is already in selection
				const isAlreadySelected = this.objectManager.selectedMeshes.includes(mesh);
				
				if (isAlreadySelected && !isMultiSelect) {
					// If already selected and no shift, we might be starting a drag
					this.draggedMesh = mesh;
					this.isDragging = true;
					
					// Calculate Offset
					const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.groundMesh);
					if (groundPick.hit) {
						// Pass the ground point to startDrag to calculate offsets for ALL selected meshes
						this.objectManager.startDrag(mesh, groundPick.pickedPoint);
					}
				} else {
					// Select logic (handles toggle for multi-select inside manager)
					this.objectManager.selectObject(mesh, isMultiSelect);
					
					// If we just selected it, we can also start dragging immediately
					if (this.objectManager.selectedMeshes.includes(mesh)) {
						this.draggedMesh = mesh;
						this.isDragging = true;
						const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.groundMesh);
						if (groundPick.hit) {
							this.objectManager.startDrag(mesh, groundPick.pickedPoint);
						}
					}
				}
			}
		}
	}
	
	handlePointerMove (info) {
		if (this.isDragging && this.draggedMesh) {
			const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.groundMesh);
			if (groundPick.hit) {
				// Pass the ground point. The manager calculates the new position based on offsets.
				this.objectManager.handleDrag(this.draggedMesh, groundPick.pickedPoint);
			}
		}
	}
	
	handlePointerUp (info) {
		if (this.isDragging) {
			this.objectManager.endDrag(this.draggedMesh);
			this.isDragging = false;
			this.draggedMesh = null;
		}
	}
	
	handleDoubleClick (info) {
		if (info.pickInfo.hit && info.pickInfo.pickedMesh !== this.groundMesh) {
			let mesh = info.pickInfo.pickedMesh;
			while (mesh.parent && (!mesh.metadata || !mesh.metadata.isObject)) {
				mesh = mesh.parent;
			}
			
			// Animate Camera Focus
			const targetPos = mesh.position.clone();
			const targetRadius = 10;
			const frameRate = 60;
			const durationFrames = 30;
			
			this.scene.stopAnimation(this.camera);
			
			BABYLON.Animation.CreateAndStartAnimation(
				'camTarget',
				this.camera,
				'target',
				frameRate,
				durationFrames,
				this.camera.target.clone(),
				targetPos,
				BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
			);
			
			BABYLON.Animation.CreateAndStartAnimation(
				'camRadius',
				this.camera,
				'radius',
				frameRate,
				durationFrames,
				this.camera.radius,
				targetRadius,
				BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
			);
		}
	}
}
