import * as BABYLON from '@babylonjs/core';

export class GizmoController {
	constructor (objectManager) {
		this.om = objectManager;
		this.scene = objectManager.scene;
		this.gizmoManager = new BABYLON.GizmoManager(this.scene);
		this.dragStartData = null;
		this.mode = 'position'; // 'position', 'rotation', 'scaling'
		
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
		const setupDragEvents = (gizmoType) => {
			const gizmo = this.gizmoManager.gizmos[gizmoType];
			if (!gizmo) return;
			
			gizmo.onDragStartObservable.add(() => {
				if (this.om.selectedMeshes.length === 0) return;
				
				// Snapshot World Transforms for Undo
				this.dragStartData = this.om.selectedMeshes.map(mesh => ({
					id: mesh.metadata.id,
					position: mesh.absolutePosition.asArray(),
					rotation: mesh.absoluteRotationQuaternion.toEulerAngles().asArray(),
					scaling: mesh.absoluteScaling.asArray()
				}));
			});
			
			gizmo.onDragEndObservable.add(() => {
				if (!this.dragStartData) return;
				
				const changes = [];
				
				// Calculate New World Transforms
				this.om.selectedMeshes.forEach(mesh => {
					const id = mesh.metadata.id;
					const startData = this.dragStartData.find(d => d.id === id);
					if (!startData) return;
					
					const currentPos = mesh.absolutePosition;
					const currentRot = mesh.absoluteRotationQuaternion.toEulerAngles();
					const currentScale = mesh.absoluteScaling;
					
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
		
		setupDragEvents('positionGizmo');
		setupDragEvents('rotationGizmo');
		setupDragEvents('scaleGizmo');
		
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
	}
	
	attachToMesh (mesh) {
		this.gizmoManager.attachToMesh(mesh);
	}
}
