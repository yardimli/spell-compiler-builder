import * as BABYLON from '@babylonjs/core';

export class GizmoController {
	constructor (objectManager) {
		this.om = objectManager;
		this.scene = objectManager.scene;
		this.gizmoManager = new BABYLON.GizmoManager(this.scene);
		this.dragStartData = null;
		this.mode = 'position'; // 'position', 'rotation', 'scaling'
		
		// Custom Plane Gizmo for X-Z / X-Y dragging
		this.planeGizmo = null;
		this.planeGizmoMesh = null;
		this.isShiftDown = false;
		
		this.setupGizmo();
	}
	
	setupGizmo () {
		// Initialize all gizmos but control visibility via updateGizmoSettings
		this.gizmoManager.positionGizmoEnabled = true;
		this.gizmoManager.rotationGizmoEnabled = true;
		this.gizmoManager.scaleGizmoEnabled = true;
		this.gizmoManager.boundingBoxGizmoEnabled = false;
		
		// Don't attach automatically on pointer events, we control attachment via selection
		this.gizmoManager.usePointerToAttachGizmos = false;
		this.gizmoManager.clearGizmoOnEmptyPointerEvent = true;
		
		// --- Undo/Redo Logic for All Gizmos ---
		const setupDragEvents = (gizmo, type) => {
			if (!gizmo) return;
			
			// FIX: PlaneDragGizmo stores observables in dragBehavior, while standard gizmos store them directly
			const onDragStart = gizmo.onDragStartObservable || (gizmo.dragBehavior && gizmo.dragBehavior.onDragStartObservable);
			const onDrag = gizmo.onDragObservable || (gizmo.dragBehavior && gizmo.dragBehavior.onDragObservable);
			const onDragEnd = gizmo.onDragEndObservable || (gizmo.dragBehavior && gizmo.dragBehavior.onDragEndObservable);
			
			if (!onDragStart || !onDragEnd) return;
			
			onDragStart.add(() => {
				if (this.om.selectedMeshes.length === 0) return;
				
				// Snapshot World Transforms for Undo
				this.dragStartData = this.om.selectedMeshes.map(mesh => {
					// Safety Check: Ensure object has transform properties (Lights might not if not wrapped)
					if (!mesh.absolutePosition) return null;
					
					return {
						id: mesh.metadata.id,
						position: mesh.absolutePosition.asArray(),
						rotation: mesh.absoluteRotationQuaternion ? mesh.absoluteRotationQuaternion.toEulerAngles().asArray() : (mesh.rotation ? mesh.rotation.asArray() : [0, 0, 0]),
						scaling: mesh.absoluteScaling ? mesh.absoluteScaling.asArray() : [1, 1, 1]
					};
				}).filter(d => d !== null);
				
				// Start Snapping Logic
				if ((type === 'positionGizmo' || type === 'planeGizmo') && this.om.snapManager) {
					if (this.om.selectedMeshes.length === 1) {
						this.om.snapManager.startSnapping(this.om.selectedMeshes[0]);
					} else if (this.om.selectionProxy) {
						this.om.snapManager.startSnapping(this.om.selectionProxy);
					}
				}
			});
			
			// Snapping during drag (Position only)
			if (type === 'positionGizmo' || type === 'planeGizmo') {
				if (onDrag) {
					onDrag.add(() => {
						if (this.om.selectedMeshes.length === 1) {
							// Single selection snap
							this.om.snapManager.snapMesh(this.om.selectedMeshes[0]);
						} else if (this.om.selectionProxy) {
							// Group selection snap (snap the proxy)
							this.om.snapManager.snapMesh(this.om.selectionProxy);
						}
					});
				}
			}
			
			onDragEnd.add(() => {
				if (!this.dragStartData) return;
				
				if (this.om.snapManager) {
					this.om.snapManager.endSnapping();
				}
				
				const changes = [];
				
				// Calculate New World Transforms
				this.om.selectedMeshes.forEach(mesh => {
					if (!mesh.absolutePosition) return; // Skip invalid objects
					
					const id = mesh.metadata.id;
					const startData = this.dragStartData.find(d => d.id === id);
					if (!startData) return;
					
					const currentPos = mesh.absolutePosition;
					const currentRot = mesh.absoluteRotationQuaternion ? mesh.absoluteRotationQuaternion.toEulerAngles() : (mesh.rotation || BABYLON.Vector3.Zero());
					const currentScale = mesh.absoluteScaling || new BABYLON.Vector3(1, 1, 1);
					
					const currentData = {
						position: currentPos.asArray(),
						rotation: currentRot.asArray(),
						scaling: currentScale.asArray()
					};
					
					// Check if changed
					if (JSON.stringify(currentData) !== JSON.stringify(startData)) {
						const objIndex = this.om.placedObjects.findIndex(o => o.id === id);
						if (objIndex !== -1) {
							this.om.placedObjects[objIndex].position = currentData.position;
							this.om.placedObjects[objIndex].rotation = currentData.rotation;
							this.om.placedObjects[objIndex].scaling = currentData.scaling;
						}
						
						changes.push({
							id: id,
							oldData: {
								position: startData.position,
								rotation: startData.rotation,
								scaling: startData.scaling
							},
							newData: currentData
						});
					}
				});
				
				if (changes.length > 0) {
					this.om.undoRedo.add({
						type: 'TRANSFORM',
						data: changes
					});
					
					if (this.om.selectedMeshes.length === 1 && this.om.onSelectionChange) {
						const data = this.om.placedObjects.find(o => o.id === this.om.selectedMeshes[0].metadata.id);
						this.om.onSelectionChange([data]);
					}
				}
				
				this.dragStartData = null;
			});
		};
		
		setupDragEvents(this.gizmoManager.gizmos.positionGizmo, 'positionGizmo');
		setupDragEvents(this.gizmoManager.gizmos.rotationGizmo, 'rotationGizmo');
		setupDragEvents(this.gizmoManager.gizmos.scaleGizmo, 'scaleGizmo');
		
		// --- Custom Plane Gizmo (Cube at Base) ---
		// Normal (0,1,0) = X-Z Plane Drag (Ground)
		this.planeGizmo = new BABYLON.PlaneDragGizmo(new BABYLON.Vector3(0, 1, 0), BABYLON.Color3.Yellow(), this.gizmoManager.utilityLayer);
		this.planeGizmo.updateGizmoRotationToMatchAttachedMesh = false; // Always world aligned
		
		// Create Cube Mesh for the Gizmo handle
		this.planeGizmoMesh = BABYLON.MeshBuilder.CreateBox("planeGizmoBox", { size: 0.02 }, this.gizmoManager.utilityLayer.utilityLayerScene);
		const mat = new BABYLON.StandardMaterial("planeGizmoMat", this.gizmoManager.utilityLayer.utilityLayerScene);
		mat.diffuseColor = BABYLON.Color3.Yellow();
		mat.emissiveColor = BABYLON.Color3.Yellow().scale(0.5);
		this.planeGizmoMesh.material = mat;
		this.planeGizmo.setCustomMesh(this.planeGizmoMesh);
		
		// Setup events for the custom gizmo
		setupDragEvents(this.planeGizmo, 'planeGizmo');
		
		// Shift Key Logic for Plane Switching
		this.scene.onKeyboardObservable.add((kbInfo) => {
			if (!this.planeGizmo || !this.planeGizmo.attachedMesh) return;
			
			const evt = kbInfo.event;
			if (evt.key === 'Shift') {
				if (evt.type === 'keydown' && !this.isShiftDown) {
					this.isShiftDown = true;
					// Shift Pressed: Switch to Z-Normal Plane (X-Y Movement)
					const normal = new BABYLON.Vector3(0, 0, 1);
					this.planeGizmo.dragPlaneNormal = normal;
					// Force update behavior options to ensure immediate effect
					if (this.planeGizmo.dragBehavior) {
						this.planeGizmo.dragBehavior.options.dragPlaneNormal = normal;
					}
					
					if (this.planeGizmoMesh.material) {
						this.planeGizmoMesh.material.diffuseColor = BABYLON.Color3.Blue();
						this.planeGizmoMesh.material.emissiveColor = BABYLON.Color3.Blue().scale(0.5);
					}
				} else if (evt.type === 'keyup') {
					this.isShiftDown = false;
					// Shift Released: Revert to Y-Normal Plane (X-Z Movement)
					const normal = new BABYLON.Vector3(0, 1, 0);
					this.planeGizmo.dragPlaneNormal = normal;
					// Force update behavior options
					if (this.planeGizmo.dragBehavior) {
						this.planeGizmo.dragBehavior.options.dragPlaneNormal = normal;
					}
					
					if (this.planeGizmoMesh.material) {
						this.planeGizmoMesh.material.diffuseColor = BABYLON.Color3.Yellow();
						this.planeGizmoMesh.material.emissiveColor = BABYLON.Color3.Yellow().scale(0.5);
					}
				}
			}
		});
		
		this.updateGizmoSettings();
	}
	
	setMode (mode) {
		this.mode = mode;
		this.updateGizmoSettings();
	}
	
	updateGizmoSettings () {
		this.gizmoManager.positionGizmoEnabled = (this.mode === 'position');
		this.gizmoManager.rotationGizmoEnabled = (this.mode === 'rotation');
		this.gizmoManager.scaleGizmoEnabled = (this.mode === 'scaling');
		
		// Sync custom gizmo visibility/attachment
		if (this.mode === 'position') {
			// If gizmo manager has something attached, attach our plane gizmo too
			const attached = this.gizmoManager.gizmos.positionGizmo.attachedMesh;
			if (this.planeGizmo) {
				this.planeGizmo.attachedMesh = attached;
			}
		} else {
			if (this.planeGizmo) {
				this.planeGizmo.attachedMesh = null;
			}
		}
	}
	
	attachToMesh (mesh) {
		this.gizmoManager.attachToMesh(mesh);
		// Sync custom gizmo
		if (this.planeGizmo && this.mode === 'position') {
			this.planeGizmo.attachedMesh = mesh;
		}
	}
}
