import { PropertyPanel } from './property-panel';
import { loadAssets } from './loader';

export class BuilderUI {
	constructor (builderScene) {
		this.scene = builderScene;
		this.manager = builderScene.objectManager;
		this.currentMapName = 'new_map';
		
		// LocalStorage Keys
		this.LS_SETTINGS_KEY = 'builder_global_settings';
		this.LS_SIDEBAR_KEY = 'builder_sidebar_state';
		
		// Default Global Settings
		this.globalSettings = {
			yOffset: 0,
			gridSize: 2.5,
			gridColor: '#555555',
			bgColor: '#2c3e50',
			snapGrid: false,
			snapObj: true,
			autoSave: true // Default enabled
		};
		
		// Auto Save State
		this.lastSaveTime = null;
		this.autoSaveInterval = null;
		this.uiUpdateInterval = null;
		
		// Ensure manager exists before creating panel
		if (this.manager) {
			this.propertyPanel = new PropertyPanel(this.manager);
		} else {
			console.error('BuilderUI: ObjectManager is null during initialization.');
		}
	}
	
	setup (assets) {
		this.loadSettings(); // Load from LocalStorage
		this.applySettings(); // Apply to Scene/Manager
		
		// Load auto-saved map if enabled and exists
		if (this.globalSettings.autoSave) {
			this.manager.loadFromAutoSave();
		}
		
		// If assets are provided (e.g. preloaded), build sidebar, otherwise show load button
		if (assets && assets.length > 0) {
			this.buildSidebar(assets);
		} else {
			this.setupLoadButton();
		}
		
		this.setupControls();
		this.setupHistoryUI();
		this.setupSettingsModal();
		this.setupContextMenu();
		this.setupAutoSaveTimer(); // Initialize timer
	}
	
	setupLoadButton () {
		const btnLoad = document.getElementById('btnLoadAssets');
		const loadArea = document.getElementById('asset-load-area');
		const overlay = document.getElementById('loading-overlay');
		
		if (btnLoad) {
			btnLoad.onclick = async () => {
				// 1. Lock UI and Camera
				overlay.style.display = 'flex';
				this.scene.setCameraLocked(true);
				
				// 2. Prepare Scene (Hide grid, hide existing objects)
				this.scene.prepareForThumbnailGeneration();
				
				try {
					// 3. Load Assets (Pass scene and camera for thumbnail generation)
					const assets = await loadAssets(this.scene.scene, this.scene.camera);
					
					// 4. Restore Scene
					this.scene.restoreAfterThumbnailGeneration();
					
					// 5. Update UI
					loadArea.style.display = 'none';
					this.buildSidebar(assets);
				} catch (e) {
					console.error('Failed to load assets:', e);
					alert('Error loading assets. Check console.');
					this.scene.restoreAfterThumbnailGeneration();
				} finally {
					// 6. Unlock
					this.scene.setCameraLocked(false);
					overlay.style.display = 'none';
				}
			};
		}
	}
	
	// --- Auto Save Logic ---
	setupAutoSaveTimer () {
		const btnSaveNow = document.getElementById('btnSaveNow');
		
		// Define the save action
		const performSave = () => {
			if (this.globalSettings.autoSave) {
				const success = this.manager.saveToAutoSave();
				if (success) {
					this.lastSaveTime = Date.now();
					this.updateAutoSaveUI();
				}
			}
		};
		
		// 1. Timer: Run every 15 seconds
		this.autoSaveInterval = setInterval(performSave, 15000);
		
		// 2. UI Updater: Run every 1 second to update relative time text
		this.uiUpdateInterval = setInterval(() => {
			this.updateAutoSaveUI();
		}, 1000);
		
		// 3. Manual Trigger
		if (btnSaveNow) {
			btnSaveNow.onclick = (e) => {
				e.preventDefault();
				performSave();
				// Reset the interval so we don't double save immediately
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
			if (diff < 60) {
				saveText.innerText = `Saved ${diff} seconds ago`;
			} else {
				const mins = Math.floor(diff / 60);
				saveText.innerText = `Saved ${mins} min ago`;
			}
		}
	}
	
	// --- LocalStorage Logic ---
	loadSettings () {
		const saved = localStorage.getItem(this.LS_SETTINGS_KEY);
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				this.globalSettings = { ...this.globalSettings, ...parsed };
			} catch (e) {
				console.error('Failed to load settings', e);
			}
		}
	}
	
	saveSettings () {
		localStorage.setItem(this.LS_SETTINGS_KEY, JSON.stringify(this.globalSettings));
	}
	
	applySettings () {
		// Apply to ObjectManager
		this.manager.defaultYOffset = parseFloat(this.globalSettings.yOffset);
		this.manager.gridSize = parseFloat(this.globalSettings.gridSize);
		this.manager.snapToGrid = this.globalSettings.snapGrid;
		this.manager.snapToObjects = this.globalSettings.snapObj;
		this.manager.autoSaveEnabled = this.globalSettings.autoSave;
		
		// Apply to Scene
		this.scene.setGridColors(this.globalSettings.gridColor, this.globalSettings.bgColor);
		this.scene.updateGridSize(this.manager.gridSize);
		
		// Sync Quick Toggles in Sidebar
		document.getElementById('chkSnapGrid').checked = this.globalSettings.snapGrid;
		document.getElementById('chkSnapObj').checked = this.globalSettings.snapObj;
		
		// Update UI text immediately
		this.updateAutoSaveUI();
	}
	
	// --- Sidebar Logic ---
	buildSidebar (assets) {
		const listContainer = document.getElementById('asset-list');
		// Clear previous content (including the load button area)
		listContainer.innerHTML = '';
		
		// Load collapsed state
		let sidebarState = {};
		try {
			sidebarState = JSON.parse(localStorage.getItem(this.LS_SIDEBAR_KEY)) || {};
		} catch (e) {}
		
		// 1. Group assets by category (prefix before first underscore)
		const categories = {};
		
		assets.forEach(asset => {
			// Extract category: "nature_rock.glb" -> "nature"
			const parts = asset.file.split('_');
			const category = parts.length > 1 ? parts[0] : 'misc';
			
			if (!categories[category]) {
				categories[category] = [];
			}
			categories[category].push(asset);
		});
		
		// 2. Create UI for each category
		Object.keys(categories).sort().forEach(categoryName => {
			// Create Header
			const header = document.createElement('div');
			header.className = 'category-header';
			header.innerText = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
			
			// Create Grid Container
			const grid = document.createElement('div');
			grid.className = 'category-grid';
			
			// Check state (Default to Collapsed if not found in LS, or if LS says so)
			const isCollapsed = sidebarState[categoryName] !== undefined ? sidebarState[categoryName] : true;
			
			if (isCollapsed) {
				header.classList.add('collapsed');
				grid.classList.add('hidden');
			}
			
			// Toggle functionality
			header.addEventListener('click', () => {
				const collapsed = header.classList.toggle('collapsed');
				grid.classList.toggle('hidden');
				
				// Save state
				sidebarState[categoryName] = collapsed;
				localStorage.setItem(this.LS_SIDEBAR_KEY, JSON.stringify(sidebarState));
			});
			
			// Add Assets to Grid
			categories[categoryName].forEach(asset => {
				const div = document.createElement('div');
				div.className = 'asset-item';
				div.dataset.file = asset.file; // Store filename for context menu
				
				const img = document.createElement('img');
				img.className = 'asset-thumb';
				img.src = asset.src;
				
				// Clean label: remove extension and category prefix
				let cleanName = asset.file.replace(/\.glb$/i, '');
				if (categoryName !== 'misc' && cleanName.startsWith(categoryName + '_')) {
					cleanName = cleanName.substring(categoryName.length + 1);
				}
				cleanName = cleanName.replace(/_/g, ' ');
				
				const span = document.createElement('span');
				span.className = 'asset-name';
				span.innerText = cleanName;
				
				div.appendChild(img);
				div.appendChild(span);
				
				div.addEventListener('click', () => {
					this.manager.addAsset(asset.file, this.scene.selectedCellPosition);
				});
				
				grid.appendChild(div);
			});
			
			listContainer.appendChild(header);
			listContainer.appendChild(grid);
		});
	}
	
	setupControls () {
		// Snapping Toggles (Quick Access)
		const chkSnapGrid = document.getElementById('chkSnapGrid');
		const chkSnapObj = document.getElementById('chkSnapObj');
		
		chkSnapGrid.onchange = (e) => {
			this.manager.snapToGrid = e.target.checked;
			this.globalSettings.snapGrid = e.target.checked;
			this.saveSettings();
		};
		chkSnapObj.onchange = (e) => {
			this.manager.snapToObjects = e.target.checked;
			this.globalSettings.snapObj = e.target.checked;
			this.saveSettings();
		};
		
		// Map Name
		const mapNameInput = document.getElementById('mapName');
		mapNameInput.oninput = (e) => {
			this.currentMapName = e.target.value;
		};
		
		// Reset Camera
		document.getElementById('btnResetCam').onclick = () => {
			this.scene.resetCamera();
		};
		
		// Save
		document.getElementById('btnSave').onclick = () => {
			const data = this.manager.getMapData(this.currentMapName);
			this.downloadJSON(data, this.currentMapName);
		};
		
		// Save As
		document.getElementById('btnSaveAs').onclick = () => {
			const newName = prompt('Enter new map name:', this.currentMapName);
			if (newName) {
				this.currentMapName = newName;
				mapNameInput.value = newName;
				const data = this.manager.getMapData(newName);
				this.downloadJSON(data, newName);
			}
		};
		
		// Load
		document.getElementById('btnLoad').onclick = () => document.getElementById('fileInput').click();
		document.getElementById('fileInput').onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (evt) => {
				try {
					const data = JSON.parse(evt.target.result);
					this.currentMapName = data.name || 'loaded_map';
					mapNameInput.value = this.currentMapName;
					this.manager.loadMapData(data);
				} catch (err) {
					console.error(err);
					alert('Invalid map file');
				}
			};
			reader.readAsText(file);
			e.target.value = '';
		};
		
		// Add Light
		document.getElementById('btnAddLight').onclick = () => {
			this.manager.addLight(this.scene.selectedCellPosition);
		};
	}
	
	setupSettingsModal () {
		const modal = document.getElementById('settingsModal');
		const btnOpen = document.getElementById('btnSettings');
		const btnCancel = document.getElementById('btnCancelSettings');
		const btnSave = document.getElementById('btnSaveSettings');
		
		// Inputs
		const inYOffset = document.getElementById('settingYOffset');
		const inGridSize = document.getElementById('settingGridSize');
		const inGridColor = document.getElementById('settingGridColor');
		const inBgColor = document.getElementById('settingBgColor');
		const inSnapGrid = document.getElementById('settingSnapGrid');
		const inSnapObj = document.getElementById('settingSnapObj');
		const inAutoSave = document.getElementById('settingAutoSave');
		
		btnOpen.onclick = () => {
			// Populate fields with current settings
			inYOffset.value = this.globalSettings.yOffset;
			inGridSize.value = this.globalSettings.gridSize;
			inGridColor.value = this.globalSettings.gridColor;
			inBgColor.value = this.globalSettings.bgColor;
			inSnapGrid.checked = this.globalSettings.snapGrid;
			inSnapObj.checked = this.globalSettings.snapObj;
			inAutoSave.checked = this.globalSettings.autoSave;
			
			modal.style.display = 'flex';
		};
		
		const close = () => { modal.style.display = 'none'; };
		
		btnCancel.onclick = close;
		
		btnSave.onclick = () => {
			// Update Settings Object
			this.globalSettings.yOffset = parseFloat(inYOffset.value);
			this.globalSettings.gridSize = parseFloat(inGridSize.value);
			this.globalSettings.gridColor = inGridColor.value;
			this.globalSettings.bgColor = inBgColor.value;
			this.globalSettings.snapGrid = inSnapGrid.checked;
			this.globalSettings.snapObj = inSnapObj.checked;
			this.globalSettings.autoSave = inAutoSave.checked;
			
			this.saveSettings();
			this.applySettings();
			close();
		};
		
		// Close on outside click
		window.onclick = (event) => {
			if (event.target === modal) close();
		};
	}
	
	setupContextMenu () {
		const menu = document.getElementById('context-menu');
		const gridItem = document.getElementById('ctx-add-grid');
		
		// Grid Modal Elements
		const gridModal = document.getElementById('gridModal');
		const btnCreateGrid = document.getElementById('btnCreateGrid');
		const btnCancelGrid = document.getElementById('btnCancelGrid');
		const inRows = document.getElementById('gridRows');
		const inCols = document.getElementById('gridCols');
		
		let targetFile = null;
		
		// Attach event listener to sidebar (delegate)
		const sidebar = document.getElementById('asset-list');
		sidebar.addEventListener('contextmenu', (e) => {
			const assetItem = e.target.closest('.asset-item');
			if (assetItem) {
				e.preventDefault();
				targetFile = assetItem.dataset.file;
				
				// Position menu
				menu.style.display = 'block';
				menu.style.left = e.pageX + 'px';
				menu.style.top = e.pageY + 'px';
			}
		});
		
		// Hide menu on click elsewhere
		window.addEventListener('click', (e) => {
			// Don't hide if clicking inside the modal
			if (e.target.closest('.modal-content')) return;
			menu.style.display = 'none';
		});
		
		// Menu Item Action: Open Modal
		gridItem.onclick = () => {
			if (targetFile) {
				menu.style.display = 'none';
				gridModal.style.display = 'flex';
				// Reset inputs to default
				inRows.value = 3;
				inCols.value = 3;
			}
		};
		
		// Modal Actions
		const closeGridModal = () => {
			gridModal.style.display = 'none';
		};
		
		btnCancelGrid.onclick = closeGridModal;
		
		btnCreateGrid.onclick = () => {
			const r = parseInt(inRows.value);
			const c = parseInt(inCols.value);
			
			if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && targetFile) {
				this.manager.addAssetGrid(targetFile, this.scene.selectedCellPosition, r, c);
				closeGridModal();
			} else {
				alert('Please enter valid positive numbers for rows and columns.');
			}
		};
		
		// Close grid modal on outside click
		gridModal.onclick = (event) => {
			if (event.target === gridModal) closeGridModal();
		};
	}
	
	setupHistoryUI () {
		const btnUndo = document.getElementById('btnUndo');
		const btnRedo = document.getElementById('btnRedo');
		
		// Updated to use the new undoRedo manager property
		btnUndo.onclick = () => this.manager.undoRedo.undo();
		btnRedo.onclick = () => this.manager.undoRedo.redo();
		
		this.manager.undoRedo.onHistoryChange = () => {
			btnUndo.disabled = this.manager.undoRedo.historyIndex < 0;
			btnRedo.disabled = this.manager.undoRedo.historyIndex >= this.manager.undoRedo.history.length - 1;
		};
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
