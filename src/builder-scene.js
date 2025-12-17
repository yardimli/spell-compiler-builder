import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { ObjectManager } from './object-manager';

export class BuilderScene {
	constructor (canvas) {
		this.canvas = canvas;
		this.engine = null;
		this.scene = null;
		this.camera = null;
		this.shadowGenerator = null;
		this.groundMesh = null;
		
		this.objectManager = null;
		
		// Interaction State
		this.selectedCellPosition = new BABYLON.Vector3(0, 0, 0);
		
		// Visual Settings Defaults
		this.gridColor = '#555555';
		this.gridBgColor = '#2c3e50';
		
		// Input State
		this.isCtrlDown = false;
		this.isAltDown = false;
		
		// Thumbnail Generation State
		this.savedState = null;
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
		this.camera = new BABYLON.ArcRotateCamera('EditorCamera', -Math.PI / 2, Math.PI / 3, 20, BABYLON.Vector3.Zero(), this.scene);
		this.camera.wheelPrecision = 50;
		this.camera.lowerRadiusLimit = 2;
		this.camera.upperRadiusLimit = 200;
		
		// --- Camera Input Configuration ---
		// Attach control immediately so scroll wheel works all the time
		this.camera.attachControl(this.canvas, true);
		this.camera.inputs.remove(this.camera.inputs.attached.keyboard);
		
		// 0 disables panning completely (Standard Input)
		this.camera.panningSensibility = 0;
		
		// Infinity makes the camera infinitely hard to rotate (effectively locking it)
		this.camera.angularSensibilityX = Infinity;
		this.camera.angularSensibilityY = Infinity;
		
		// 4. Object Manager (Handles Logic)
		// Pass 'this' (BuilderScene) instead of scene and shadowGenerator
		// so ObjectManager can request shadow generator setup.
		this.objectManager = new ObjectManager(this);
		
		// 5. Grid (Created after settings are loaded in UI, but init here with defaults)
		this.createGrid(this.objectManager.gridSize);
		
		// 6. Interaction
		this.setupInteraction();
		this.setupKeyboardControls();
		
		// 7. Render Loop
		this.engine.runRenderLoop(() => {
			this.scene.render();
		});
		
		window.addEventListener('resize', () => {
			this.engine.resize();
		});
		
		return [];
	}
	
	// Helper to setup the shadow generator for a specific light (called by ObjectManager)
	setupShadows (light) {
		if (this.shadowGenerator) {
			this.shadowGenerator.dispose();
		}
		
		this.shadowGenerator = new BABYLON.ShadowGenerator(2048, light);
		// Use PCF for softer shadows if available, otherwise BlurExponential
		this.shadowGenerator.usePercentageCloserFiltering = true;
		this.shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
		// Ensure objects cast shadows on each other properly
		this.shadowGenerator.transparencyShadow = true;
		this.shadowGenerator.bias = 0.0001; // Small bias to prevent acne
	}
	
	// --- Camera Locking ---
	setCameraLocked (isLocked) {
		if (isLocked) {
			this.camera.detachControl();
		} else {
			this.camera.attachControl(this.canvas, true);
		}
	}
	
	// --- Thumbnail Generation Helpers ---
	prepareForThumbnailGeneration () {
		// Save current state
		this.savedState = {
			cameraAlpha: this.camera.alpha,
			cameraBeta: this.camera.beta,
			cameraRadius: this.camera.radius,
			cameraTarget: this.camera.target.clone(),
			gridEnabled: this.groundMesh.isEnabled(),
			clearColor: this.scene.clearColor.clone(),
			// Disable Gizmos during thumbnail generation
			gizmosEnabled: this.objectManager.gizmoManager.positionGizmoEnabled
		};
		
		// Hide Grid
		this.groundMesh.setEnabled(false);
		
		// Hide Gizmos
		this.objectManager.gizmoManager.positionGizmoEnabled = false;
		this.objectManager.gizmoManager.rotationGizmoEnabled = false;
		this.objectManager.gizmoManager.scaleGizmoEnabled = false;
		
		// Hide all placed objects
		this.objectManager.placedObjects.forEach(obj => {
			const mesh = this.objectManager.findMeshById(obj.id);
			if (mesh) mesh.setEnabled(false);
		});
		
		// Set transparent background for screenshot
		this.scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);
	}
	
	restoreAfterThumbnailGeneration () {
		if (!this.savedState) return;
		
		// Restore Camera
		this.camera.alpha = this.savedState.cameraAlpha;
		this.camera.beta = this.savedState.cameraBeta;
		this.camera.radius = this.savedState.cameraRadius;
		this.camera.setTarget(this.savedState.cameraTarget);
		
		// Restore Visibility
		this.groundMesh.setEnabled(this.savedState.gridEnabled);
		this.scene.clearColor = this.savedState.clearColor;
		
		// Restore Gizmos (Only restore the one that was enabled, or default to position)
		// Actually, ObjectManager handles state, so we just re-trigger its update
		this.objectManager.updateGizmoSettings();
		
		// Restore objects
		this.objectManager.placedObjects.forEach(obj => {
			const mesh = this.objectManager.findMeshById(obj.id);
			if (mesh) mesh.setEnabled(true);
		});
		
		this.savedState = null;
	}
	
	// --- New Camera Reset Method ---
	resetCamera () {
		const targetPos = BABYLON.Vector3.Zero();
		const targetRadius = 20;
		const targetAlpha = -Math.PI / 2;
		const targetBeta = Math.PI / 3;
		
		// Stop existing animations
		this.scene.stopAnimation(this.camera);
		
		// Create animations for smooth transition
		const frameRate = 60;
		const durationFrames = 45;
		
		BABYLON.Animation.CreateAndStartAnimation('camTarget', this.camera, 'target', frameRate, durationFrames, this.camera.target.clone(), targetPos, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
		BABYLON.Animation.CreateAndStartAnimation('camRadius', this.camera, 'radius', frameRate, durationFrames, this.camera.radius, targetRadius, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
		BABYLON.Animation.CreateAndStartAnimation('camAlpha', this.camera, 'alpha', frameRate, durationFrames, this.camera.alpha, targetAlpha, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
		BABYLON.Animation.CreateAndStartAnimation('camBeta', this.camera, 'beta', frameRate, durationFrames, this.camera.beta, targetBeta, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
	}
	
	createGrid (gridSize) {
		const width = 100;
		const height = 100;
		const textureResolution = 9182; // High res for better clarity
		
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
		gradient.addColorStop(0, this.shadeColor(this.gridBgColor, -60));
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
	shadeColor (color, percent) {
		let R = parseInt(color.substring(1, 3), 16);
		let G = parseInt(color.substring(3, 5), 16);
		let B = parseInt(color.substring(5, 7), 16);
		
		R = parseInt(R * (100 + percent) / 100);
		G = parseInt(G * (100 + percent) / 100);
		B = parseInt(B * (100 + percent) / 100);
		
		R = (R < 255) ? R : 255;
		G = (G < 255) ? G : 255;
		B = (B < 255) ? B : 255;
		
		const RR = ((R.toString(16).length === 1) ? '0' + R.toString(16) : R.toString(16));
		const GG = ((G.toString(16).length === 1) ? '0' + G.toString(16) : G.toString(16));
		const BB = ((B.toString(16).length === 1) ? '0' + B.toString(16) : B.toString(16));
		
		return '#' + RR + GG + BB;
	}
	
	setGridColors (lineColor, bgColor) {
		this.gridColor = lineColor;
		this.gridBgColor = bgColor;
		// Re-render grid with new colors
		this.createGrid(this.objectManager.gridSize);
	}
	
	updateGridSize (size) {
		this.objectManager.gridSize = size;
		this.createGrid(size);
	}
	
	setupKeyboardControls () {
		// Track key states for manual interaction
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Control') {
				this.isCtrlDown = true;
			} else if (e.key === 'Alt') {
				this.isAltDown = true;
				e.preventDefault(); // Prevent browser menu focus
			}
			
			// Arrow Key Nudge Logic
			if (this.objectManager.selectedMeshes.length > 0) {
				// Ignore if user is typing in an input
				if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
				
				let dx = 0, dy = 0, dz = 0;
				const step = this.objectManager.cursorIncrement;
				let handled = false;
				
				switch (e.key) {
					case 'ArrowLeft':
						dx = -step;
						handled = true;
						break;
					case 'ArrowRight':
						dx = step;
						handled = true;
						break;
					case 'ArrowUp':
						if (e.shiftKey) dy = step;
						else dz = step;
						handled = true;
						break;
					case 'ArrowDown':
						if (e.shiftKey) dy = -step;
						else dz = -step;
						handled = true;
						break;
				}
				
				if (handled) {
					e.preventDefault(); // Stop camera movement / scrolling
					this.objectManager.nudgeSelection(dx, dy, dz);
				}
			}
		});
		
		window.addEventListener('keyup', (e) => {
			if (e.key === 'Control') {
				this.isCtrlDown = false;
			} else if (e.key === 'Alt') {
				this.isAltDown = false;
			}
		});
		
		// Fix for Alt-Tab sticking keys
		window.addEventListener('blur', () => {
			this.isCtrlDown = false;
			this.isAltDown = false;
		});
		
		window.addEventListener('focus', () => {
			this.isCtrlDown = false;
			this.isAltDown = false;
		});
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
		// If manipulating camera, do not select objects
		if (this.isCtrlDown || this.isAltDown) return;
		
		const pick = info.pickInfo;
		const isMultiSelect = info.event.shiftKey;
		
		if (pick.hit) {
			// Check if we are in "Placement Mode" (an asset is selected in sidebar)
			if (this.objectManager.activeAssetFile) {
				// Use the Ghost Position calculated during PointerMove
				const targetPosition = this.objectManager.ghostPosition.clone();
				
				// Place the asset using the calculated ghost position
				this.objectManager.addAsset(this.objectManager.activeAssetFile, targetPosition);
				
				// Stop processing (don't select the object underneath)
				return;
			}
			
			// 1. Handle Grid Click (Deselect)
			if (pick.pickedMesh === this.groundMesh) {
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
				// Check if object is locked
				const objData = this.objectManager.placedObjects.find(o => o.id === mesh.metadata.id);
				// Allow selection if Shift (isMultiSelect) is pressed, even if locked
				if (objData && objData.isLocked && !isMultiSelect) {
					// Prevent selection from canvas if locked
					return;
				}
				
				// Select logic (handles toggle for multi-select inside manager)
				this.objectManager.selectObject(mesh, isMultiSelect);
			}
		}
	}
	
	handlePointerMove (info) {
		// 1. Manual Camera Control (No Click)
		if (this.isCtrlDown || this.isAltDown) {
			const evt = info.event;
			// Use movementX/Y for delta
			const dx = evt.movementX || evt.mozMovementX || evt.webkitMovementX || 0;
			const dy = evt.movementY || evt.mozMovementY || evt.webkitMovementY || 0;
			
			// Sensitivity for manual movement
			const sensitivity = 1000;
			
			if (this.isAltDown) {
				// Orbit (Alt + Move)
				this.camera.inertialAlphaOffset -= dx / sensitivity;
				this.camera.inertialBetaOffset -= dy / sensitivity;
			} else if (this.isCtrlDown) {
				// Pan (Ctrl + Move)
				if (evt.shiftKey) {
					// 3rd Axis Panning (Forward/Backward)
					// Move target along the camera's local Z axis
					const forward = this.camera.getDirection(BABYLON.Axis.Z);
					// Multiplier to match feel of inertial panning (direct pos update vs inertia)
					const zSensitivity = 25;
					const dist = (-dy / sensitivity) * zSensitivity;
					this.camera.target.addInPlace(forward.scale(dist));
				} else {
					this.camera.inertialPanningX -= dx / sensitivity;
					this.camera.inertialPanningY += dy / sensitivity;
				}
			}
			return;
		}
		
		// 2. Ghost Asset Movement
		if (this.objectManager.activeAssetFile) {
			// Force a pick to ensure we get the ground even if the event pick was swallowed or blocked
			// We filter out the ghost mesh explicitly to be safe
			const pick = this.scene.pick(
				this.scene.pointerX,
				this.scene.pointerY,
				(mesh) => {
					// Must be pickable, enabled, and NOT a ghost
					return mesh.isPickable &&
						mesh.isEnabled() &&
						(!mesh.metadata || !mesh.metadata.isGhost);
				}
			);
			
			if (pick.hit) {
				this.objectManager.updateGhostPosition(pick);
			}
		}
	}
	
	handlePointerUp (info) {
		// Drag end logic handled by GizmoManager
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
