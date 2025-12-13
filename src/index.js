import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { loadAssets } from "./loader"; // Import the loader

// --- CONFIGURATION ---
const ASSET_FOLDER = "./assets/nature/";
const SNAP_THRESHOLD = 2.0;

// --- STATE ---
let engine, scene, camera, shadowGenerator;
let groundMesh;
let currentMapName = "new_map";
let placedObjects = [];
let ghostMesh = null;
let selectedAssetFile = null;
let currentGridSize = 5;

// --- INITIALIZATION ---
const canvas = document.getElementById("renderCanvas");

async function init() {
	// 1. Engine Setup
	engine = new BABYLON.Engine(canvas, true, {
		disableWebGL2Support: false,
		useHighPrecisionMatrix: true,
		preserveDrawingBuffer: true,
		stencil: true
	});
	
	// 2. Scene Setup
	scene = new BABYLON.Scene(engine);
	
	// Camera
	camera = new BABYLON.UniversalCamera("UniversalCamera", new BABYLON.Vector3(0, 20, -20), scene);
	camera.setTarget(BABYLON.Vector3.Zero());
	camera.attachControl(canvas, true);
	
	// Inputs (WASD)
	camera.keysUp.push(87);    camera.keysDown.push(83);
	camera.keysLeft.push(65);  camera.keysRight.push(68);
	camera.speed = 0.8;
	
	// Lights
	const hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
	hemiLight.intensity = 0.7;
	const dirLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-1, -2, -1), scene);
	dirLight.position = new BABYLON.Vector3(20, 40, 20);
	dirLight.intensity = 0.8;
	
	shadowGenerator = new BABYLON.ShadowGenerator(2048, dirLight);
	shadowGenerator.useBlurExponentialShadowMap = true;
	
	// Grid
	createGrid(currentGridSize);
	
	// 3. Load Assets (Async)
	// This will trigger downloads if cache is missing
	const assets = await loadAssets(engine);
	buildSidebarUI(assets);
	
	// 4. Interaction Setup
	setupDragAndDrop();
	setupUIControls();
	
	// 5. Render Loop
	engine.runRenderLoop(() => {
		scene.render();
	});
	
	window.addEventListener("resize", () => {
		engine.resize();
	});
}

// --- UI GENERATION ---
function buildSidebarUI(assets) {
	const grid = document.getElementById("asset-grid");
	grid.innerHTML = ""; // Clear existing
	
	assets.forEach(asset => {
		const div = document.createElement("div");
		div.className = "asset-item";
		div.draggable = true;
		
		const img = document.createElement("img");
		img.className = "asset-thumb";
		img.src = asset.src;
		
		const span = document.createElement("span");
		span.className = "asset-name";
		span.innerText = asset.file;
		
		div.appendChild(img);
		div.appendChild(span);
		
		// Drag Start
		div.addEventListener("dragstart", (e) => {
			selectedAssetFile = asset.file;
			e.dataTransfer.setData("text/plain", asset.file);
		});
		
		grid.appendChild(div);
	});
}

// --- GRID SYSTEM ---
function createGrid(gridSize) {
	if (!groundMesh) {
		groundMesh = BABYLON.MeshBuilder.CreateGround("ground", { width: 200, height: 200 }, scene);
		groundMesh.receiveShadows = true;
		
		const textureResolution = 512;
		const gridTexture = new BABYLON.DynamicTexture("gridTex", textureResolution, scene, true);
		const ctx = gridTexture.getContext();
		
		ctx.fillStyle = "#555555";
		ctx.fillRect(0, 0, textureResolution, textureResolution);
		ctx.strokeStyle = "#aaaaaa";
		ctx.lineWidth = 5;
		ctx.strokeRect(0, 0, textureResolution, textureResolution);
		gridTexture.update();
		
		const mat = new BABYLON.StandardMaterial("gridMat", scene);
		mat.diffuseTexture = gridTexture;
		mat.specularColor = new BABYLON.Color3(0, 0, 0);
		groundMesh.material = mat;
	}
	const tiles = 200 / gridSize;
	groundMesh.material.diffuseTexture.uScale = tiles;
	groundMesh.material.diffuseTexture.vScale = tiles;
}

// --- DRAG AND DROP ---
function setupDragAndDrop() {
	const canvasZone = document.getElementById("renderCanvas");
	
	canvasZone.addEventListener("dragover", (e) => {
		e.preventDefault();
		const pickResult = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === groundMesh);
		
		if (pickResult.hit) {
			if (!ghostMesh && selectedAssetFile) {
				loadGhostMesh(selectedAssetFile, pickResult.pickedPoint);
			}
			if (ghostMesh) {
				let targetPos = pickResult.pickedPoint.clone();
				const snapPos = getSnapPosition(targetPos);
				snapPos.y = ghostMesh.position.y;
				ghostMesh.position = snapPos;
			}
		}
	});
	
	canvasZone.addEventListener("drop", (e) => {
		e.preventDefault();
		if (ghostMesh) {
			const metadata = {
				id: BABYLON.Tools.RandomId(),
				file: selectedAssetFile,
				position: ghostMesh.position.asArray(),
				rotation: ghostMesh.rotationQuaternion ? ghostMesh.rotationQuaternion.toEulerAngles().asArray() : ghostMesh.rotation.asArray(),
				scaling: ghostMesh.scaling.asArray()
			};
			placedObjects.push(metadata);
			ghostMesh.name = "obj_" + metadata.id;
			ghostMesh.isPickable = true;
			ghostMesh = null;
			selectedAssetFile = null;
		}
	});
	
	// Cleanup if dragged out
	canvasZone.addEventListener("dragleave", () => {
		if(ghostMesh) {
			ghostMesh.dispose();
			ghostMesh = null;
		}
	});
}

function loadGhostMesh(filename, position) {
	if (ghostMesh) return;
	const dummy = new BABYLON.Mesh("dummy", scene);
	ghostMesh = dummy;
	
	BABYLON.SceneLoader.ImportMeshAsync("", ASSET_FOLDER, filename, scene).then((result) => {
		dummy.dispose();
		const root = result.meshes[0];
		ghostMesh = root;
		
		const hierarchy = root.getChildMeshes(false);
		hierarchy.forEach(m => {
			m.isPickable = false;
			shadowGenerator.addShadowCaster(m, true);
		});
		
		const bounds = root.getHierarchyBoundingVectors();
		const heightOffset = -bounds.min.y;
		root.position = position.clone();
		root.position.y += heightOffset;
	}).catch(err => {
		console.error("Error loading asset:", err);
		ghostMesh = null;
	});
}

function getSnapPosition(currentPos) {
	let closestDist = Number.MAX_VALUE;
	let snapPos = currentPos.clone();
	
	scene.meshes.forEach(mesh => {
		if (mesh.name.startsWith("obj_")) {
			const dist = BABYLON.Vector3.Distance(currentPos, mesh.position);
			if (dist < SNAP_THRESHOLD && dist < closestDist) {
				snapPos.x = mesh.position.x;
				snapPos.z = mesh.position.z;
				closestDist = dist;
			}
		}
	});
	return snapPos;
}

// --- UI CONTROLS ---
function setupUIControls() {
	const slider = document.getElementById("gridSizeInput");
	const label = document.getElementById("gridSizeLabel");
	slider.oninput = (e) => {
		currentGridSize = parseInt(e.target.value);
		label.innerText = currentGridSize + " units";
		createGrid(currentGridSize);
	};
	
	document.getElementById("btnSave").onclick = () => saveMap(document.getElementById("mapName").value);
	
	document.getElementById("btnSaveAs").onclick = () => {
		const newName = prompt("Enter new map name:", currentMapName);
		if (newName) {
			currentMapName = newName;
			document.getElementById("mapName").value = newName;
			saveMap(newName);
		}
	};
	
	document.getElementById("btnLoad").onclick = () => document.getElementById("fileInput").click();
	document.getElementById("fileInput").onchange = (e) => {
		const file = e.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (evt) => loadMap(evt.target.result);
		reader.readAsText(file);
		e.target.value = "";
	};
	
	document.getElementById("btnAddLight").onclick = () => {
		const light = new BABYLON.PointLight("pointLight_" + Date.now(), new BABYLON.Vector3(0, 5, 0), scene);
		light.intensity = 0.5;
		const sphere = BABYLON.MeshBuilder.CreateSphere("lightGizmo", {diameter: 0.5}, scene);
		sphere.position = light.position;
		sphere.material = new BABYLON.StandardMaterial("lm", scene);
		sphere.material.emissiveColor = new BABYLON.Color3(1,1,0);
		sphere.setParent(light);
		placedObjects.push({ type: "light", id: light.name, position: light.position.asArray() });
	};
}

function saveMap(mapName) {
	const mapData = { name: mapName, version: 1, assets: placedObjects };
	const json = JSON.stringify(mapData, null, 2);
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = mapName + ".json";
	a.click();
	URL.revokeObjectURL(url);
}

function loadMap(jsonString) {
	try {
		const data = JSON.parse(jsonString);
		currentMapName = data.name || "loaded_map";
		document.getElementById("mapName").value = currentMapName;
		const toDispose = scene.meshes.filter(m => m.name.startsWith("obj_") || m.name.startsWith("pointLight_"));
		toDispose.forEach(m => m.dispose());
		placedObjects = [];
		if (data.assets) {
			data.assets.forEach(item => {
				if (item.type === "light") { /* Light Logic */ }
				else {
					BABYLON.SceneLoader.ImportMeshAsync("", ASSET_FOLDER, item.file, scene).then(res => {
						const root = res.meshes[0];
						root.name = "obj_" + item.id;
						root.position = BABYLON.Vector3.FromArray(item.position);
						if(item.rotation) root.rotation = BABYLON.Vector3.FromArray(item.rotation);
						if(item.scaling) root.scaling = BABYLON.Vector3.FromArray(item.scaling);
						res.meshes.forEach(m => { shadowGenerator.addShadowCaster(m, true); m.receiveShadows = true; });
						placedObjects.push(item);
					});
				}
			});
		}
	} catch (e) { console.error(e); alert("Invalid map file"); }
}

init();
