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
		this.camera.attachControl(this.canvas, true);
		this.camera.wheelPrecision = 50;
		this.camera.panningSensibility = 50;
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
		
		// 5. Object Manager (Handles Logic)
		this.objectManager = new ObjectManager(this.scene, this.shadowGenerator);
		
		// 6. Grid & Cursor
		this.createGrid(this.objectManager.gridSize);
		this.createCursor();
		
		// 7. Interaction
		this.setupInteraction();
		
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
		
		// Background
		const gradient = ctx.createLinearGradient(0, 0, 0, textureResolution);
		gradient.addColorStop(0, '#1a1a1a');
		gradient.addColorStop(1, '#2c3e50');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, textureResolution, textureResolution);
		
		// Grid Lines
		ctx.strokeStyle = '#555555';
		// Reduced line width to 1 (50% smaller visually) to match the tighter grid
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
		const pick = info.pickInfo;
		
		if (pick.hit) {
			// 1. Handle Grid Click (Deselect)
			if (pick.pickedMesh === this.groundMesh) {
				this.updateCursorPosition(pick.pickedPoint);
				this.objectManager.selectObject(null);
				return;
			}
			
			// 2. Handle Object Click
			let mesh = pick.pickedMesh;
			// Traverse up to find the root object with metadata
			while (mesh && (!mesh.metadata || !mesh.metadata.isObject) && mesh.parent) {
				mesh = mesh.parent;
			}
			
			if (mesh && mesh.metadata && mesh.metadata.isObject) {
				// Logic: Only start dragging if the object is ALREADY selected.
				// Otherwise, just select it.
				if (this.objectManager.selectedMesh === mesh) {
					this.draggedMesh = mesh;
					this.isDragging = true;
					this.camera.detachControl();
					
					// Calculate Offset
					const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.groundMesh);
					if (groundPick.hit) {
						this.dragOffset = mesh.position.subtract(groundPick.pickedPoint);
						this.dragOffset.y = 0;
					}
					
					this.objectManager.startDrag(mesh);
				} else {
					this.objectManager.selectObject(mesh);
				}
			}
		}
	}
	
	handlePointerMove (info) {
		if (this.isDragging && this.draggedMesh) {
			const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.groundMesh);
			if (groundPick.hit) {
				const targetPos = groundPick.pickedPoint.add(this.dragOffset);
				targetPos.y = this.draggedMesh.position.y;
				this.objectManager.handleDrag(this.draggedMesh, targetPos);
			}
		}
	}
	
	handlePointerUp (info) {
		if (this.isDragging) {
			this.objectManager.endDrag(this.draggedMesh);
			this.isDragging = false;
			this.draggedMesh = null;
			this.camera.attachControl(this.canvas, true);
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
