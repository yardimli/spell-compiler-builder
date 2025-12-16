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
			autoSave: true
		};

		// Auto Save State
		this.lastSaveTime = null;
		this.autoSaveInterval = null;
		this.uiUpdateInterval = null;

		if (this.manager) {
			this.propertyPanel = new PropertyPanel(this.manager);
			this.treeView = new TreeView(this.manager);

			// NEW: Listen for asset selection changes to update UI
			this.manager.onAssetSelectionChange = (file) => {
				this.updateSidebarSelection(file);
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

		this.setupAssetBrowser();
		this.setupControls();
		this.setupLeftSidebarToggle();
		this.setupHistoryUI();
		this.setupSettingsModal();
		this.setupSaveModal();
		this.setupContextMenu();
		this.setupAutoSaveTimer();

		// NEW: Setup the sidebar splitter
		this.setupSplitter();
	}

	setupAssetBrowser () {
		const folderSelect = document.getElementById('asset-folder-select');
		const btnLoad = document.getElementById('btnLoadAssets');
		const loadArea = document.getElementById('asset-load-area');
		const listContainer = document.getElementById('asset-list');
		const overlay = document.getElementById('loading-overlay');

		// 1. Populate Dropdown
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

			// Restore last selected folder
			const lastFolder = localStorage.getItem(this.LS_LAST_FOLDER_KEY);
			if (lastFolder && folders.includes(lastFolder)) {
				folderSelect.value = lastFolder;
				btnLoad.disabled = false;
				btnLoad.innerText = `Load ${lastFolder}`;
			}
		}

		// 2. Handle Dropdown Change
		folderSelect.onchange = () => {
			const selectedFolder = folderSelect.value;
			if (selectedFolder) {
				localStorage.setItem(this.LS_LAST_FOLDER_KEY, selectedFolder);

				// Reset View
				const items = listContainer.querySelectorAll('.category-header, .category-grid');
				items.forEach(el => el.remove());

				loadArea.style.display = 'flex';
				btnLoad.disabled = false;
				btnLoad.innerText = `Load ${selectedFolder}`;
			}
		};

		// 3. Handle Load Button Click
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
				this.buildSidebar(assets, selectedFolder);
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

	// --- Sidebar Logic (Updated for Grouping) ---
	buildSidebar (assets, folderName) {
		const listContainer = document.getElementById('asset-list');

		// Clear previous content (headers and grids)
		const existingItems = listContainer.querySelectorAll('.category-header, .category-grid');
		existingItems.forEach(el => el.remove());

		// Load collapsed state
		let sidebarState = {};
		try {
			sidebarState = JSON.parse(localStorage.getItem(this.LS_SIDEBAR_KEY)) || {};
		} catch (e) {}

		// 1. Group assets by prefix (split by '-' or '_')
		const groups = {};

		assets.forEach(asset => {
			// asset.file is "folder/filename.glb"
			const filename = asset.file.split('/').pop(); // "rock-large.glb"
			const nameNoExt = filename.replace(/\.glb$/i, ''); // "rock-large"

			// Split by '-' or '_' to find group name
			const parts = nameNoExt.split(/[_-]/);
			const groupName = parts.length > 1 ? parts[0] : 'misc';

			if (!groups[groupName]) {
				groups[groupName] = [];
			}
			groups[groupName].push(asset);
		});

		// 2. Create UI for each group
		Object.keys(groups).sort().forEach(groupName => {
			// Create Header
			const header = document.createElement('div');
			header.className = 'category-header';
			header.innerText = groupName.charAt(0).toUpperCase() + groupName.slice(1);

			// Create Grid Container
			const grid = document.createElement('div');
			grid.className = 'category-grid';

			// Check state (Default to Collapsed if not found/undefined)
			// Using a unique key combining folder and group to avoid collisions
			const stateKey = `${folderName}:${groupName}`;
			const isCollapsed = sidebarState[stateKey] !== undefined ? sidebarState[stateKey] : true;

			if (isCollapsed) {
				header.classList.add('collapsed');
				grid.classList.add('hidden');
			}

			// Toggle functionality
			header.addEventListener('click', () => {
				const collapsed = header.classList.toggle('collapsed');
				grid.classList.toggle('hidden');

				// Save state
				sidebarState[stateKey] = collapsed;
				localStorage.setItem(this.LS_SIDEBAR_KEY, JSON.stringify(sidebarState));
			});

			// Add Assets to Grid
			groups[groupName].forEach(asset => {
				const div = document.createElement('div');
				div.className = 'asset-item';
				div.dataset.file = asset.file;

				const img = document.createElement('img');
				img.className = 'asset-thumb';
				img.src = asset.src;

				// Clean label: remove extension and group prefix
				let cleanName = asset.file.split('/').pop().replace(/\.glb$/i, '');

				// Remove the group prefix from the name for cleaner display
				// e.g. "rock-large" -> "large" inside "Rock" group
				if (groupName !== 'misc' && cleanName.toLowerCase().startsWith(groupName.toLowerCase())) {
					// Remove prefix and any following separator
					cleanName = cleanName.substring(groupName.length).replace(/^[_-]/, '');
				}

				// If name became empty (e.g. file was just "rock.glb" in "rock" group), revert to full name
				if (!cleanName) cleanName = groupName;

				cleanName = cleanName.replace(/[_-]/g, ' ');

				const span = document.createElement('span');
				span.className = 'asset-name';
				span.innerText = cleanName;

				div.appendChild(img);
				div.appendChild(span);

				// NEW: Click selects the asset for placement instead of placing immediately
				div.addEventListener('click', () => {
					this.manager.setActiveAsset(asset.file);
				});

				grid.appendChild(div);
			});

			listContainer.appendChild(header);
			listContainer.appendChild(grid);
		});
	}

	// NEW: Helper to visually update the sidebar selection
	updateSidebarSelection (selectedFile) {
		const items = document.querySelectorAll('.asset-item');
		items.forEach(item => {
			if (item.dataset.file === selectedFile) {
				item.classList.add('selected');
			} else {
				item.classList.remove('selected');
			}
		});
	}

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

	// NEW: Setup Splitter Logic
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

			// Calculate percentage
			let percentage = (relativeY / sidebarRect.height) * 100;

			// Constraints (min 10%, max 90%)
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
		document.getElementById('btnAddLight').onclick = () => { this.manager.addLight(this.scene.selectedCellPosition); };
		document.getElementById('btnClearScene').onclick = () => {
			if (confirm('Are you sure you want to clear the entire scene?')) {
				this.manager.clearScene();
				this.currentMapName = 'new_map';
			}
		};

		// NEW: Clear Selection Button Logic
		document.getElementById('btnClearSelection').onclick = () => {
			this.clearAllSelections();
		};

		// NEW: ESC Key Logic
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.clearAllSelections();
				this.manager.releaseAnchor(); // Release anchor on ESC
			}

			// NEW: Delete Key Logic
			if (e.key === 'Delete') {
				// Prevent deletion if user is typing in an input field
				const tag = e.target.tagName;
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

				this.manager.deleteSelected();
			}
		});

		// NEW: Cursor Increment Input
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

	// NEW: Helper to clear both asset placement selection and scene object selection
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

		btnOpen.onclick = () => {
			inYOffset.value = this.globalSettings.yOffset;
			inGridSize.value = this.globalSettings.gridSize;
			inGridColor.value = this.globalSettings.gridColor;
			inBgColor.value = this.globalSettings.bgColor;
			inAutoSave.checked = this.globalSettings.autoSave;
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
			this.saveSettings();
			this.applySettings();
			close();
		};
		window.onclick = (event) => { if (event.target === modal) close(); };
	}

	setupContextMenu () {
		const menu = document.getElementById('context-menu');
		const gridItem = document.getElementById('ctx-add-grid');

		// New Menu Items
		const setAnchorItem = document.getElementById('ctx-set-anchor');
		const releaseAnchorItem = document.getElementById('ctx-release-anchor');
		const deleteAssetItem = document.getElementById('ctx-delete-asset');

		const gridModal = document.getElementById('gridModal');
		const btnCreateGrid = document.getElementById('btnCreateGrid');
		const btnCancelGrid = document.getElementById('btnCancelGrid');
		const inRows = document.getElementById('gridRows');
		const inCols = document.getElementById('gridCols');

		let targetFile = null;
		let targetMesh = null;

		// 1. Sidebar Context Menu
		const sidebar = document.getElementById('asset-list');
		sidebar.addEventListener('contextmenu', (e) => {
			const assetItem = e.target.closest('.asset-item');
			if (assetItem) {
				e.preventDefault();
				targetFile = assetItem.dataset.file;
				targetMesh = null;

				// Show Sidebar items, Hide Scene items
				document.querySelectorAll('.sidebar-only').forEach(el => el.style.display = 'block');
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
				// Find root object
				while (mesh && (!mesh.metadata || !mesh.metadata.isObject) && mesh.parent) {
					mesh = mesh.parent;
				}

				if (mesh && mesh.metadata && mesh.metadata.isObject) {
					e.preventDefault();
					targetMesh = mesh;
					targetFile = null;

					// Show Scene items, Hide Sidebar items
					document.querySelectorAll('.sidebar-only').forEach(el => el.style.display = 'none');
					document.querySelectorAll('.scene-only').forEach(el => el.style.display = 'block');

					menu.style.display = 'block';
					menu.style.left = e.pageX + 'px';
					menu.style.top = e.pageY + 'px';
				}
			}
		});

		// Global Click to Close
		window.addEventListener('click', (e) => {
			if (e.target.closest('.modal-content')) return;
			menu.style.display = 'none';
		});

		// --- Action Handlers ---

		// Grid Action
		gridItem.onclick = () => {
			if (targetFile) {
				menu.style.display = 'none';
				gridModal.style.display = 'flex';
				inRows.value = 3; inCols.value = 3;
			}
		};

		// Anchor Actions
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

		// Grid Modal Logic
		const closeGridModal = () => { gridModal.style.display = 'none'; };
		btnCancelGrid.onclick = closeGridModal;
		btnCreateGrid.onclick = () => {
			const r = parseInt(inRows.value);
			const c = parseInt(inCols.value);
			if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && targetFile) {
				this.manager.addAssetGrid(targetFile, this.scene.selectedCellPosition, r, c);
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