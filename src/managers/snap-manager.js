import * as BABYLON from '@babylonjs/core';

export class SnapManager {
    constructor (objectManager) {
        this.om = objectManager;
        this.scene = objectManager.scene;

        // Anchor State
        this.anchorMesh = null;
        this.anchorIndicator = null;

        // Settings
        this.snapThreshold = 2.0;
    }

    /**
     * Sets a mesh as the active anchor and creates the visual indicator.
     * @param {BABYLON.Mesh} mesh
     */
    setAnchor (mesh) {
        // If picking the same anchor, do nothing
        if (this.anchorMesh === mesh) return;

        this.clearAnchor();

        if (!mesh) return;

        this.anchorMesh = mesh;

        // Create Visual Indicator (Blinking Ball)
        const bounds = mesh.getHierarchyBoundingVectors();
        const height = bounds.max.y - bounds.min.y;
        const center = bounds.min.add(bounds.max).scale(0.5);

        // Position slightly above the object
        const indicatorPos = new BABYLON.Vector3(center.x, bounds.max.y + 1.0, center.z);

        this.anchorIndicator = BABYLON.MeshBuilder.CreateSphere("anchorIndicator", { diameter: 0.8 }, this.scene);
        this.anchorIndicator.position = indicatorPos;
        this.anchorIndicator.isPickable = false;

        // Emissive Material
        const mat = new BABYLON.StandardMaterial("anchorMat", this.scene);
        mat.emissiveColor = new BABYLON.Color3(0, 1, 1); // Cyan
        mat.disableLighting = true;
        mat.alpha = 0.8;
        this.anchorIndicator.material = mat;

        // Blinking Animation
        const animation = new BABYLON.Animation(
            "blink",
            "visibility",
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );

        const keys = [
            { frame: 0, value: 0.2 },
            { frame: 15, value: 1.0 },
            { frame: 30, value: 0.2 }
        ];

        animation.setKeys(keys);
        this.anchorIndicator.animations.push(animation);
        this.scene.beginAnimation(this.anchorIndicator, 0, 30, true);

        // Parent indicator to mesh so it moves with it (if mesh is moved via gizmo)
        this.anchorIndicator.setParent(mesh);
    }

    /**
     * Removes the anchor and disposes the indicator.
     */
    clearAnchor () {
        if (this.anchorIndicator) {
            this.anchorIndicator.dispose();
            this.anchorIndicator = null;
        }
        this.anchorMesh = null;
    }

    /**
     * Calculates the best snap position for a moving mesh against the target (Anchor or Selection).
     * @param {BABYLON.Vector3} currentPos - The current world position of the moving object/ghost.
     * @param {Object} movingBoundsLocal - Local bounds {min, max} of the moving object.
     * @param {BABYLON.Quaternion} movingRotation - Rotation of the moving object.
     * @param {BABYLON.Vector3} movingScaling - Scaling of the moving object.
     * @param {Array<BABYLON.Mesh>} targets - Array of meshes to snap against.
     * @returns {BABYLON.Vector3|null} - The offset vector to apply, or null if no snap.
     */
    calculateSnapOffset (currentPos, movingBoundsLocal, movingRotation, movingScaling, targets) {
        if (!targets || targets.length === 0) return null;

        let bestSnap = null;
        let minDistance = this.snapThreshold;

        // 1. Calculate Moving Object Points (OBB) in World Space
        const lMin = movingBoundsLocal.min;
        const lMax = movingBoundsLocal.max;
        const lCenter = lMin.add(lMax).scale(0.5);

        // 9 points on the bottom face
        const localPoints = [
            new BABYLON.Vector3(lMin.x, lMin.y, lMin.z),
            new BABYLON.Vector3(lCenter.x, lMin.y, lMin.z),
            new BABYLON.Vector3(lMax.x, lMin.y, lMin.z),
            new BABYLON.Vector3(lMin.x, lMin.y, lCenter.z),
            new BABYLON.Vector3(lCenter.x, lMin.y, lCenter.z),
            new BABYLON.Vector3(lMax.x, lMin.y, lCenter.z),
            new BABYLON.Vector3(lMin.x, lMin.y, lMax.z),
            new BABYLON.Vector3(lCenter.x, lMin.y, lMax.z),
            new BABYLON.Vector3(lMax.x, lMin.y, lMax.z)
        ];

        // Transform to World Space
        const rotation = movingRotation || BABYLON.Quaternion.Identity();
        const matrix = BABYLON.Matrix.Compose(movingScaling, rotation, currentPos);
        const movingWorldPoints = localPoints.map(p => BABYLON.Vector3.TransformCoordinates(p, matrix));

        // 2. Calculate Target Points
        for (const targetMesh of targets) {
            // Skip if target is the moving mesh itself
            if (targetMesh === this.om.ghostMesh) continue;

            const targetWorldPoints = [];

            // Get pickable meshes in hierarchy
            const meshes = targetMesh.getChildMeshes(false, (m) => m.isEnabled() && m.isVisible && m.isPickable);
            if (targetMesh.isPickable) meshes.push(targetMesh);

            meshes.forEach(m => {
                const box = m.getBoundingInfo().boundingBox;
                const v = box.vectorsWorld; // 8 corners

                // Add Corners
                for (const p of v) targetWorldPoints.push(p);

                // Add Midpoints of edges
                // Bottom
                targetWorldPoints.push(v[0].add(v[1]).scale(0.5));
                targetWorldPoints.push(v[1].add(v[2]).scale(0.5));
                targetWorldPoints.push(v[2].add(v[3]).scale(0.5));
                targetWorldPoints.push(v[3].add(v[0]).scale(0.5));
                // Top
                targetWorldPoints.push(v[4].add(v[5]).scale(0.5));
                targetWorldPoints.push(v[5].add(v[6]).scale(0.5));
                targetWorldPoints.push(v[6].add(v[7]).scale(0.5));
                targetWorldPoints.push(v[7].add(v[4]).scale(0.5));
            });

            if (targetWorldPoints.length === 0) {
                targetWorldPoints.push(targetMesh.absolutePosition.clone());
            }

            // Find closest match
            for (const mp of movingWorldPoints) {
                for (const tp of targetWorldPoints) {
                    const dx = tp.x - mp.x;
                    const dy = tp.y - mp.y;
                    const dz = tp.z - mp.z;

                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (dist < minDistance) {
                        minDistance = dist;
                        bestSnap = { x: dx, y: dy, z: dz };
                    }
                }
            }
        }

        return bestSnap;
    }

    /**
     * Called by GizmoController when dragging existing objects.
     * @param {BABYLON.Mesh} mesh - The mesh being dragged.
     */
    snapMesh (mesh) {
        // Only snap if we have an anchor
        if (!this.anchorMesh) return;

        // Don't snap to self
        if (mesh === this.anchorMesh) return;

        // Prepare data for calculation
        const currentPos = mesh.absolutePosition;
        const bounds = mesh.getHierarchyBoundingVectors();

        // Calculate local bounds roughly (assuming pivot is somewhat central or bottom)
        // Ideally we cache this like in ObjectManager, but for existing objects we calculate on fly
        // We need local bounds relative to the pivot (position).
        // Since we can't easily get "Local Bounds" from World Bounds without matrix math,
        // we will approximate by using the world bounds relative to the current position.
        const localMin = bounds.min.subtract(currentPos);
        const localMax = bounds.max.subtract(currentPos);

        const movingBoundsLocal = { min: localMin, max: localMax };

        const snapOffset = this.calculateSnapOffset(
            currentPos,
            movingBoundsLocal,
            mesh.rotationQuaternion || BABYLON.Quaternion.FromEulerVector(mesh.rotation),
            mesh.scaling,
            [this.anchorMesh]
        );

        if (snapOffset) {
            mesh.position.x += snapOffset.x;
            mesh.position.y += snapOffset.y;
            mesh.position.z += snapOffset.z;
        }
    }
}