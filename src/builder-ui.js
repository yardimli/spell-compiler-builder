import * as BABYLON from '@babylonjs/core';
import { PropertyPanel } from './property-panel';
import { TreeView } from './tree-view';
import { loadAssets, getAvailableFolders } from './loader';

export class BuilderUI {
	constructor (builderScene) {
		this.scene = builderScene;
		this.manager = builderScene.objectManager;
		this.currentMapName = 'new_map';
		
		// LocalStorage Keys
		this.LS_SETTINGS_KEY = 'builder_global_settings';
		this.LS_SIDEBAR_KEY = 'builder_sidebar_state';
		this.LS_LAST_FOLDER_KEY = 'builder_last_folder';
		
		// Default Global Settings
		this.globalSettings = {
			yOffset: 0,
			gridSize: 2.5,
			gridColor: '#555555',
			bgColor: '#2c3e50',
			autoSave: true,
			posStep: 0.1,
			rotStep: 15,
			scaleStep: 0.1,
			cursorStep: 0.05
		};
		
		this.lastSaveTime = null;
		this.autoSaveInterval = null;
		this.uiUpdateInterval = null;
		
		if (this.manager) {
			this.propertyPanel = new PropertyPanel(this.manager);
			this.treeView = new TreeView(this.manager);
			
			this.manager.onAssetSelectionChange = (name) => {
				this.updateAssetStoreSelection(name);
			};
			
			// Listen for store changes to re-render the store list
			this.manager.onStoreChange = () => {
				this.renderAssetStore();
			};
		} else {
			console.error('BuilderUI: ObjectManager is null during initialization.');
		}
	}
	
	setup (assets) {
		this.loadSettings();
		this.applySettings();
		
		if (this.globalSettings.autoSave) {
			this.manager.loadFromAutoSave();
		}
		
		this.setupFileBrowser(); // Renamed from setupAssetBrowser
		this.setupControls();
		this.setupLeftSidebarToggle();
		this.setupHistoryUI();
		this.setupSettingsModal();
		this.setupSaveModal();
		this.setupContextMenu();
		this.setupAutoSaveTimer();
		this.setupSplitter();
		this.setupStatusCoordinates();
		
		// Initial Render of Store
		this.renderAssetStore();
	}
	
	// ... (setupStatusCoordinates remains same) ...
	setupStatusCoordinates () {
		const coordsEl = document.getElementById('status-coords');
		if (!coordsEl) return;
		
		this.scene.scene.onPointerObservable.add((pointerInfo) => {
			if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
				const ray = this.scene.scene.createPickingRay(
					this.scene.scene.pointerX,
					this.scene.scene.pointerY,
					BABYLON.Matrix.Identity(),
					this.scene.camera
				);
				
				const plane = BABYLON.Plane.FromPositionAndNormal(BABYLON.Vector3.Zero(), BABYLON.Vector3.Up());
				const distance = ray.intersectsPlane(plane);
				
				if (distance !== null && distance !== undefined) {
					const hit = ray.origin.add(ray.direction.scale(distance));
					coordsEl.innerText = `X: ${hit.x.toFixed(2)}  Y: ${hit.y.toFixed(2)}  Z: ${hit.z.toFixed(2)}`;
				}
			}
		});
	}
	
	setupFileBrowser () {
		const folderSelect = document.getElementById('asset-folder-select');
		const btnLoad = document.getElementById('btnLoadAssets');
		const loadArea = document.getElementById('asset-load-area');
		const listContainer = document.getElementById('asset-list');
		const overlay = document.getElementById('loading-overlay');
		
		const folders = getAvailableFolders();
		if (folders.length === 0) {
			const opt = document.createElement('option');
			opt.text = "No folders found";
			folderSelect.add(opt);
			folderSelect.disabled = true;
		} else {
			folders.forEach(folder => {
				const opt = document.createElement('option');
				opt.value = folder;
				opt.text = folder.charAt(0).toUpperCase() + folder.slice(1);
				folderSelect.add(opt);
			});
			
			const lastFolder = localStorage.getItem(this.LS_LAST_FOLDER_KEY);
			if (lastFolder && folders.includes(lastFolder)) {
				folderSelect.value = lastFolder;
				btnLoad.disabled = false;
				btnLoad.innerText = `Load ${lastFolder}`;
			}
		}
		
		folderSelect.onchange = () => {
			const selectedFolder = folderSelect.value;
			if (selectedFolder) {
				localStorage.setItem(this.LS_LAST_FOLDER_KEY, selectedFolder);
				
				const items = listContainer.querySelectorAll('.category-header, .category-grid');
				items.forEach(el => el.remove());
				
				loadArea.style.display = 'flex';
				btnLoad.disabled = false;
				btnLoad.innerText = `Load ${selectedFolder}`;
			}
		};
		
		btnLoad.onclick = async () => {
			const selectedFolder = folderSelect.value;
			if (!selectedFolder) return;
			
			overlay.style.display = 'flex';
			this.scene.setCameraLocked(true);
			this.scene.prepareForThumbnailGeneration();
			
			try {
				const assets = await loadAssets(this.scene.scene, this.scene.camera, selectedFolder);
				this.scene.restoreAfterThumbnailGeneration();
				loadArea.style.display = 'none';
				this.renderFileBrowser(assets, selectedFolder);
			} catch (e) {
				console.error('Failed to load assets:', e);
				alert('Error loading assets. Check console.');
				this.scene.restoreAfterThumbnailGeneration();
			} finally {
				this.scene.setCameraLocked(false);
				overlay.style.display = 'none';
			}
		};
	}
	
	// Renders the File Browser (Bottom Panel)
	renderFileBrowser (assets, folderName) {
		const listContainer = document.getElementById('asset-list');
		const existingItems = listContainer.querySelectorAll('.category-header, .category-grid');
		existingItems.forEach(el => el.remove());
		
		let sidebarState = {};
		try {
			sidebarState = JSON.parse(localStorage.getItem(this.LS_SIDEBAR_KEY)) || {};
		} catch (e) {}
		
		const groups = {};
		
		assets.forEach(asset => {
			const filename = asset.file.split('/').pop();
			const nameNoExt = filename.replace(/\.glb$/i, '');
			const parts = nameNoExt.split(/[_-]/);
			const groupName = parts.length > 1 ? parts[0] : 'misc';
			
			if (!groups[groupName]) {
				groups[groupName] = [];
			}
			groups[groupName].push(asset);
		});
		
		Object.keys(groups).sort().forEach(groupName => {
			const header = document.createElement('div');
			header.className = 'category-header';
			header.innerText = groupName.charAt(0).toUpperCase() + groupName.slice(1);
			
			const grid = document.createElement('div');
			grid.className = 'category-grid';
			
			const stateKey = `${folderName}:${groupName}`;
			const isCollapsed = sidebarState[stateKey] !== undefined ? sidebarState[stateKey] : true;
			
			if (isCollapsed) {
				header.classList.add('collapsed');
				grid.classList.add('hidden');
			}
			
			header.addEventListener('click', () => {
				const collapsed = header.classList.toggle('collapsed');
				grid.classList.toggle('hidden');
				sidebarState[stateKey] = collapsed;
				localStorage.setItem(this.LS_SIDEBAR_KEY, JSON.stringify(sidebarState));
			});
			
			groups[groupName].forEach(asset => {
				const div = document.createElement('div');
				div.className = 'asset-item browser-item'; // Add browser-item class
				div.dataset.file = asset.file;
				div.dataset.thumb = asset.src;
				
				const img = document.createElement('img');
				img.className = 'asset-thumb';
				img.src = asset.src;
				
				let cleanName = asset.file.split('/').pop().replace(/\.glb$/i, '');
				if (groupName !== 'misc' && cleanName.toLowerCase().startsWith(groupName.toLowerCase())) {
					cleanName = cleanName.substring(groupName.length).replace(/^[_-]/, '');
				}
				if (!cleanName) cleanName = groupName;
				cleanName = cleanName.replace(/[_-]/g, ' ');
				
				const span = document.createElement('span');
				span.className = 'asset-name';
				span.innerText = cleanName;
				
				div.appendChild(img);
				div.appendChild(span);
				
				// Click on Browser Item -> Prompt to add to store
				div.addEventListener('click', () => {
					this.openAddAssetModal(asset.file, asset.src, cleanName);
				});
				
				grid.appendChild(div);
			});
			
			listContainer.appendChild(header);
			listContainer.appendChild(grid);
		});
	}
	
	// Renders the Asset Store (Top Panel)
	renderAssetStore () {
		const container = document.getElementById('asset-store-list');
		container.innerHTML = '';
		
		const assets = this.manager.assetManager.getAllAssets();
		
		if (assets.length === 0) {
			container.innerHTML = '<div class="empty-state">No assets in store.<br>Add from File Browser below.</div>';
			return;
		}
		
		const grid = document.createElement('div');
		grid.className = 'category-grid';
		grid.style.padding = '5px';
		
		assets.forEach(asset => {
			const div = document.createElement('div');
			div.className = 'asset-item store-item';
			div.dataset.name = asset.name;
			
			const img = document.createElement('img');
			img.className = 'asset-thumb';
			img.src = asset.thumbnail;
			
			const span = document.createElement('span');
			span.className = 'asset-name';
			span.innerText = asset.name;
			
			div.appendChild(img);
			div.appendChild(span);
			
			// Click on Store Item -> Set Active Asset for placement
			div.addEventListener('click', () => {
				this.manager.setActiveAsset(asset.name);
			});
			
			grid.appendChild(div);
		});
		
		container.appendChild(grid);
		
		// Re-apply selection highlight
		if (this.manager.activeAssetName) {
			this.updateAssetStoreSelection(this.manager.activeAssetName);
		}
	}
	
	updateAssetStoreSelection (selectedName) {
		const items = document.querySelectorAll('.store-item');
		items.forEach(item => {
			if (item.dataset.name === selectedName) {
				item.classList.add('selected');
			} else {
				item.classList.remove('selected');
			}
		});
	}
	
	// Modal to add asset to store
	openAddAssetModal (file, thumb, defaultName) {
		const modal = document.getElementById('addAssetModal');
		const input = document.getElementById('inputAssetName');
		const btnConfirm = document.getElementById('btnConfirmAddAsset');
		const btnCancel = document.getElementById('btnCancelAddAsset');
		
		input.value = defaultName.replace(/\s+/g, '_'); // Suggest ID-friendly name
		modal.style.display = 'flex';
		input.focus();
		
		const close = () => { modal.style.display = 'none'; };
		
		btnCancel.onclick = close;
		
		btnConfirm.onclick = () => {
			const name = input.value.trim();
			if (!name) {
				alert('Please enter a name.');
				return;
			}
			
			this.manager.addAssetToStore(name, file, thumb).then(() => {
				close();
			}).catch(err => {
				alert('Failed to add asset: ' + err.message);
			});
		};
		
		// Handle Enter key
		input.onkeydown = (e) => {
			if (e.key === 'Enter') btnConfirm.click();
		};
	}
	
	// ... (setupAutoSaveTimer, updateAutoSaveUI, loadSettings, saveSettings, applySettings, setupLeftSidebarToggle, setupSplitter remain same) ...
	setupAutoSaveTimer () {
		const btnSaveNow = document.getElementById('btnSaveNow');
		const performSave = () => {
			if (this.globalSettings.autoSave) {
				const success = this.manager.saveToAutoSave();
				if (success) {
					this.lastSaveTime = Date.now();
					this.updateAutoSaveUI();
				}
			}
		};
		this.autoSaveInterval = setInterval(performSave, 15000);
		this.uiUpdateInterval = setInterval(() => { this.updateAutoSaveUI(); }, 1000);
		if (btnSaveNow) {
			btnSaveNow.onclick = (e) => {
				e.preventDefault();
				performSave();
				clearInterval(this.autoSaveInterval);
				this.autoSaveInterval = setInterval(performSave, 15000);
			};
		}
	}
	
	updateAutoSaveUI () {
		const saveText = document.getElementById('auto-save-text');
		if (!saveText) return;
		if (!this.globalSettings.autoSave) {
			saveText.innerText = 'Auto-save disabled';
			return;
		}
		if (!this.lastSaveTime) {
			saveText.innerText = 'Not saved yet.';
		} else {
			const diff = Math.floor((Date.now() - this.lastSaveTime) / 1000);
			if (diff < 60) saveText.innerText = `Saved ${diff} seconds ago`;
			else saveText.innerText = `Saved ${Math.floor(diff / 60)} min ago`;
		}
	}
	
	loadSettings () {
		const saved = localStorage.getItem(this.LS_SETTINGS_KEY);
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				this.globalSettings = { ...this.globalSettings, ...parsed };
			} catch (e) { console.error('Failed to load settings', e); }
		}
	}
	
	saveSettings () {
		localStorage.setItem(this.LS_SETTINGS_KEY, JSON.stringify(this.globalSettings));
	}
	
	applySettings () {
		this.manager.defaultYOffset = parseFloat(this.globalSettings.yOffset);
		this.manager.gridSize = parseFloat(this.globalSettings.gridSize);
		this.manager.autoSaveEnabled = this.globalSettings.autoSave;
		
		this.manager.posStep = parseFloat(this.globalSettings.posStep);
		this.manager.rotStep = parseFloat(this.globalSettings.rotStep);
		this.manager.scaleStep = parseFloat(this.globalSettings.scaleStep);
		this.manager.cursorIncrement = parseFloat(this.globalSettings.cursorStep);
		
		if (this.propertyPanel) {
			this.propertyPanel.updateInputSteps();
		}
		
		const cursorInput = document.getElementById('inputCursorStep');
		if (cursorInput) cursorInput.value = this.manager.cursorIncrement;
		
		this.scene.setGridColors(this.globalSettings.gridColor, this.globalSettings.bgColor);
		this.scene.updateGridSize(this.manager.gridSize);
		this.updateAutoSaveUI();
	}
	
	setupLeftSidebarToggle () {
		const sidebar = document.getElementById('left-sidebar');
		const header = document.getElementById('left-sidebar-header');
		if (header && sidebar) {
			header.onclick = () => { sidebar.classList.toggle('collapsed'); };
		}
	}
	
	setupSplitter () {
		const splitter = document.getElementById('sidebar-splitter');
		const propPanel = document.getElementById('properties-panel');
		const rightSidebar = document.getElementById('right-sidebar');
		
		if (!splitter || !propPanel || !rightSidebar) return;
		
		let isDragging = false;
		
		splitter.addEventListener('mousedown', (e) => {
			isDragging = true;
			document.body.style.cursor = 'row-resize';
			e.preventDefault();
		});
		
		window.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			
			const sidebarRect = rightSidebar.getBoundingClientRect();
			const relativeY = e.clientY - sidebarRect.top;
			
			let percentage = (relativeY / sidebarRect.height) * 100;
			if (percentage < 10) percentage = 10;
			if (percentage > 90) percentage = 90;
			
			propPanel.style.height = `${percentage}%`;
		});
		
		window.addEventListener('mouseup', () => {
			if (isDragging) {
				isDragging = false;
				document.body.style.cursor = '';
			}
		});
	}
	
	setupControls () {
		document.getElementById('btnResetCam').onclick = () => { this.scene.resetCamera(); };
		document.getElementById('btnLoad').onclick = () => document.getElementById('fileInput').click();
		document.getElementById('fileInput').onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (evt) => {
				try {
					const data = JSON.parse(evt.target.result);
					this.currentMapName = data.name || 'loaded_map';
					this.manager.loadMapData(data);
				} catch (err) { console.error(err); alert('Invalid map file'); }
			};
			reader.readAsText(file);
			e.target.value = '';
		};
		
		document.getElementById('btnAddPointLight').onclick = () => { this.manager.addLight('point'); };
		document.getElementById('btnAddDirLight').onclick = () => { this.manager.addLight('directional'); };
		document.getElementById('btnAddHemiLight').onclick = () => { this.manager.addLight('hemispheric'); };
		
		document.getElementById('btnClearScene').onclick = () => {
			if (confirm('Are you sure you want to clear the entire scene?')) {
				this.manager.clearScene();
				this.currentMapName = 'new_map';
			}
		};
		
		document.getElementById('btnClearSelection').onclick = () => {
			this.clearAllSelections();
		};
		
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.clearAllSelections();
				this.manager.releaseAnchor();
			}
			
			if (e.key === 'Delete') {
				const tag = e.target.tagName;
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
				this.manager.deleteSelected();
			}
		});
		
		const inputStep = document.getElementById('inputCursorStep');
		if (inputStep) {
			inputStep.onchange = (e) => {
				const val = parseFloat(e.target.value);
				if (!isNaN(val) && val > 0) {
					this.manager.cursorIncrement = val;
				}
			};
		}
	}
	
	clearAllSelections () {
		this.manager.setActiveAsset(null);
		this.manager.selectObject(null, false);
	}
	
	setupSaveModal () {
		const modal = document.getElementById('saveMapModal');
		const btnSave = document.getElementById('btnSave');
		const btnSaveAs = document.getElementById('btnSaveAs');
		const btnConfirm = document.getElementById('btnConfirmSave');
		const btnCancel = document.getElementById('btnCancelSave');
		const inputName = document.getElementById('saveMapName');
		
		const openModal = () => { inputName.value = this.currentMapName; modal.style.display = 'flex'; inputName.focus(); };
		const closeModal = () => { modal.style.display = 'none'; };
		
		btnSave.onclick = () => {
			if (this.currentMapName === 'new_map') openModal();
			else this.downloadJSON(this.manager.getMapData(this.currentMapName), this.currentMapName);
		};
		btnSaveAs.onclick = openModal;
		btnCancel.onclick = closeModal;
		btnConfirm.onclick = () => {
			const name = inputName.value.trim();
			if (name) {
				this.currentMapName = name;
				this.downloadJSON(this.manager.getMapData(this.currentMapName), this.currentMapName);
				closeModal();
			} else alert('Please enter a map name.');
		};
		window.onclick = (event) => { if (event.target === modal) closeModal(); };
	}
	
	setupSettingsModal () {
		const modal = document.getElementById('settingsModal');
		const btnOpen = document.getElementById('btnSettings');
		const btnCancel = document.getElementById('btnCancelSettings');
		const btnSave = document.getElementById('btnSaveSettings');
		const inYOffset = document.getElementById('settingYOffset');
		const inGridSize = document.getElementById('settingGridSize');
		const inGridColor = document.getElementById('settingGridColor');
		const inBgColor = document.getElementById('settingBgColor');
		const inAutoSave = document.getElementById('settingAutoSave');
		
		const inPosStep = document.getElementById('settingPosStep');
		const inRotStep = document.getElementById('settingRotStep');
		const inScaleStep = document.getElementById('settingScaleStep');
		const inCursorStep = document.getElementById('settingCursorStep');
		
		btnOpen.onclick = () => {
			inYOffset.value = this.globalSettings.yOffset;
			inGridSize.value = this.globalSettings.gridSize;
			inGridColor.value = this.globalSettings.gridColor;
			inBgColor.value = this.globalSettings.bgColor;
			inAutoSave.checked = this.globalSettings.autoSave;
			
			inPosStep.value = this.globalSettings.posStep;
			inRotStep.value = this.globalSettings.rotStep;
			inScaleStep.value = this.globalSettings.scaleStep;
			inCursorStep.value = this.globalSettings.cursorStep;
			
			modal.style.display = 'flex';
		};
		
		const close = () => { modal.style.display = 'none'; };
		btnCancel.onclick = close;
		btnSave.onclick = () => {
			this.globalSettings.yOffset = parseFloat(inYOffset.value);
			this.globalSettings.gridSize = parseFloat(inGridSize.value);
			this.globalSettings.gridColor = inGridColor.value;
			this.globalSettings.bgColor = inBgColor.value;
			this.globalSettings.autoSave = inAutoSave.checked;
			
			this.globalSettings.posStep = parseFloat(inPosStep.value);
			this.globalSettings.rotStep = parseFloat(inRotStep.value);
			this.globalSettings.scaleStep = parseFloat(inScaleStep.value);
			this.globalSettings.cursorStep = parseFloat(inCursorStep.value);
			
			this.saveSettings();
			this.applySettings();
			close();
		};
		window.onclick = (event) => { if (event.target === modal) close(); };
	}
	
	setupContextMenu () {
		const menu = document.getElementById('context-menu');
		const gridItemStore = document.getElementById('ctx-add-grid-store');
		const addToStoreItem = document.getElementById('ctx-add-to-store');
		
		const setAnchorItem = document.getElementById('ctx-set-anchor');
		const releaseAnchorItem = document.getElementById('ctx-release-anchor');
		const deleteAssetItem = document.getElementById('ctx-delete-asset');
		
		const gridModal = document.getElementById('gridModal');
		const btnCreateGrid = document.getElementById('btnCreateGrid');
		const btnCancelGrid = document.getElementById('btnCancelGrid');
		const inRows = document.getElementById('gridRows');
		const inCols = document.getElementById('gridCols');
		
		let targetAssetName = null;
		let targetBrowserFile = null;
		let targetBrowserThumb = null;
		let targetMesh = null;
		
		// 1. Sidebar Context Menu
		const sidebar = document.getElementById('left-sidebar');
		sidebar.addEventListener('contextmenu', (e) => {
			const storeItem = e.target.closest('.store-item');
			const browserItem = e.target.closest('.browser-item');
			
			if (storeItem) {
				e.preventDefault();
				targetAssetName = storeItem.dataset.name;
				targetBrowserFile = null;
				targetMesh = null;
				
				document.querySelectorAll('.store-only').forEach(el => el.style.display = 'block');
				document.querySelectorAll('.browser-only').forEach(el => el.style.display = 'none');
				document.querySelectorAll('.scene-only').forEach(el => el.style.display = 'none');
				
				menu.style.display = 'block';
				menu.style.left = e.pageX + 'px';
				menu.style.top = e.pageY + 'px';
			} else if (browserItem) {
				e.preventDefault();
				targetBrowserFile = browserItem.dataset.file;
				targetBrowserThumb = browserItem.dataset.thumb;
				targetAssetName = null;
				targetMesh = null;
				
				document.querySelectorAll('.store-only').forEach(el => el.style.display = 'none');
				document.querySelectorAll('.browser-only').forEach(el => el.style.display = 'block');
				document.querySelectorAll('.scene-only').forEach(el => el.style.display = 'none');
				
				menu.style.display = 'block';
				menu.style.left = e.pageX + 'px';
				menu.style.top = e.pageY + 'px';
			}
		});
		
		// 2. Scene Context Menu
		const canvas = document.getElementById('renderCanvas');
		canvas.addEventListener('contextmenu', (e) => {
			const pick = this.scene.scene.pick(this.scene.scene.pointerX, this.scene.scene.pointerY);
			
			if (pick.hit && pick.pickedMesh && pick.pickedMesh.name !== 'ground') {
				let mesh = pick.pickedMesh;
				while (mesh && (!mesh.metadata || !mesh.metadata.isObject) && mesh.parent) {
					mesh = mesh.parent;
				}
				
				if (mesh && mesh.metadata && mesh.metadata.isObject) {
					e.preventDefault();
					targetMesh = mesh;
					targetAssetName = null;
					targetBrowserFile = null;
					
					document.querySelectorAll('.store-only').forEach(el => el.style.display = 'none');
					document.querySelectorAll('.browser-only').forEach(el => el.style.display = 'none');
					document.querySelectorAll('.scene-only').forEach(el => el.style.display = 'block');
					
					menu.style.display = 'block';
					menu.style.left = e.pageX + 'px';
					menu.style.top = e.pageY + 'px';
				}
			}
		});
		
		window.addEventListener('click', (e) => {
			if (e.target.closest('.modal-content')) return;
			menu.style.display = 'none';
		});
		
		// Actions
		gridItemStore.onclick = () => {
			if (targetAssetName) {
				menu.style.display = 'none';
				gridModal.style.display = 'flex';
				inRows.value = 3; inCols.value = 3;
			}
		};
		
		addToStoreItem.onclick = () => {
			if (targetBrowserFile) {
				menu.style.display = 'none';
				// Guess a name
				const name = targetBrowserFile.split('/').pop().replace(/\.glb$/i, '');
				this.openAddAssetModal(targetBrowserFile, targetBrowserThumb, name);
			}
		};
		
		setAnchorItem.onclick = () => {
			if (targetMesh) {
				this.manager.setAnchor(targetMesh);
				menu.style.display = 'none';
			}
		};
		
		releaseAnchorItem.onclick = () => {
			this.manager.releaseAnchor();
			menu.style.display = 'none';
		};
		
		deleteAssetItem.onclick = () => {
			if (targetMesh) {
				this.manager.removeObjectById(targetMesh.metadata.id);
				menu.style.display = 'none';
			}
		};
		
		const closeGridModal = () => { gridModal.style.display = 'none'; };
		btnCancelGrid.onclick = closeGridModal;
		btnCreateGrid.onclick = () => {
			const r = parseInt(inRows.value);
			const c = parseInt(inCols.value);
			if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && targetAssetName) {
				this.manager.addAssetGrid(targetAssetName, this.scene.selectedCellPosition, r, c);
				closeGridModal();
			} else alert('Please enter valid positive numbers.');
		};
		gridModal.onclick = (event) => { if (event.target === gridModal) closeGridModal(); };
	}
	
	setupHistoryUI () {
		const btnUndo = document.getElementById('btnUndo');
		const btnRedo = document.getElementById('btnRedo');
		btnUndo.onclick = () => this.manager.undoRedo.undo();
		btnRedo.onclick = () => this.manager.undoRedo.redo();
		this.manager.undoRedo.onHistoryChange = () => {
			btnUndo.disabled = this.manager.undoRedo.historyIndex < 0;
			btnRedo.disabled = this.manager.undoRedo.historyIndex >= this.manager.undoRedo.history.length - 1;
		};
		window.addEventListener('keydown', (e) => {
			if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
			if (e.ctrlKey) {
				if (e.key.toLowerCase() === 'z') { e.preventDefault(); this.manager.undoRedo.undo(); }
				else if (e.key.toLowerCase() === 'y') { e.preventDefault(); this.manager.undoRedo.redo(); }
			}
		});
	}
	
	downloadJSON (data, filename) {
		const json = JSON.stringify(data, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename + '.json';
		a.click();
		URL.revokeObjectURL(url);
	}
}
