export class TreeView {
	constructor (objectManager) {
		this.manager = objectManager;
		this.container = document.getElementById('tree-view');
		this.header = document.getElementById('tree-header');
		this.content = document.getElementById('tree-content');
		this.toggleIcon = document.getElementById('tree-toggle-icon');
		
		this.isExpanded = false;
		this.lastClickedIndex = -1; // For shift-click logic
		
		this.setupUI();
		
		// Subscribe to manager events
		if (this.manager) {
			this.manager.onListChange = () => this.render();
			// Hook into selection change to highlight items
			const originalSelectionChange = this.manager.onSelectionChange;
			this.manager.onSelectionChange = (data) => {
				if (originalSelectionChange) originalSelectionChange(data);
				this.highlightSelection(data);
			};
		}
	}
	
	setupUI () {
		// Toggle Collapse/Expand
		this.header.onclick = () => {
			this.isExpanded = !this.isExpanded;
			if (this.isExpanded) {
				this.container.classList.add('expanded');
				this.toggleIcon.style.transform = 'rotate(180deg)';
			} else {
				this.container.classList.remove('expanded');
				this.toggleIcon.style.transform = 'rotate(0deg)';
			}
		};
	}
	
	render () {
		this.content.innerHTML = '';
		
		// 1. Render Groups
		this.manager.groups.forEach(group => {
			this.renderGroup(group);
		});
		
		// 2. Render Ungrouped Objects
		const groupedIds = this.manager.groups.flatMap(g => g.objectIds);
		const ungroupedObjects = this.manager.placedObjects.filter(obj => !groupedIds.includes(obj.id));
		
		// Sort alphabetically
		ungroupedObjects.sort((a, b) => a.name.localeCompare(b.name));
		
		ungroupedObjects.forEach(obj => {
			this.renderObjectItem(obj, this.content);
		});
		
		// Re-apply highlights based on current selection
		const currentSelection = this.manager.selectedMeshes.map(m => this.manager.placedObjects.find(o => o.id === m.metadata.id)).filter(Boolean);
		this.highlightSelection(currentSelection);
	}
	
	renderGroup (group) {
		const groupContainer = document.createElement('div');
		groupContainer.className = 'tree-group';
		groupContainer.dataset.groupId = group.id;
		
		// Header
		const header = document.createElement('div');
		header.className = 'tree-group-header';
		
		const titleSpan = document.createElement('span');
		titleSpan.innerText = group.name;
		
		// Rename Logic
		titleSpan.ondblclick = (e) => {
			e.stopPropagation();
			const input = document.createElement('input');
			input.type = 'text';
			input.className = 'tree-rename-input';
			input.value = group.name;
			
			const saveName = () => {
				const newName = input.value.trim();
				if (newName) {
					this.manager.renameGroup(group.id, newName);
				} else {
					titleSpan.innerText = group.name; // Revert
				}
			};
			
			input.onblur = saveName;
			input.onkeydown = (ev) => { if (ev.key === 'Enter') saveName(); };
			
			header.replaceChild(input, titleSpan);
			input.focus();
		};
		
		// Actions (Delete)
		const actions = document.createElement('div');
		actions.className = 'tree-group-actions';
		const btnDelete = document.createElement('button');
		btnDelete.className = 'btn-tree-action delete';
		btnDelete.innerHTML = '×';
		btnDelete.title = 'Ungroup (Delete Group)';
		btnDelete.onclick = (e) => {
			e.stopPropagation();
			if (confirm(`Ungroup "${group.name}"? Objects will not be deleted.`)) {
				this.manager.deleteGroup(group.id);
			}
		};
		actions.appendChild(btnDelete);
		
		header.appendChild(titleSpan);
		header.appendChild(actions);
		
		// Select all in group on click
		header.onclick = (e) => {
			if (!e.shiftKey && !e.ctrlKey) {
				this.manager.selectObjectsByIds(group.objectIds);
			}
		};
		
		groupContainer.appendChild(header);
		
		// Items Container
		const itemsContainer = document.createElement('div');
		itemsContainer.className = 'tree-group-items';
		
		// Find objects belonging to this group
		const groupObjects = group.objectIds
			.map(id => this.manager.placedObjects.find(o => o.id === id))
			.filter(Boolean);
		
		groupObjects.sort((a, b) => a.name.localeCompare(b.name));
		
		groupObjects.forEach(obj => {
			this.renderObjectItem(obj, itemsContainer);
		});
		
		groupContainer.appendChild(itemsContainer);
		this.content.appendChild(groupContainer);
	}
	
	renderObjectItem (obj, parentContainer) {
		const item = document.createElement('div');
		item.className = 'tree-item';
		item.dataset.id = obj.id;
		
		// Icon based on type
		const icon = document.createElement('span');
		icon.className = 'tree-icon';
		icon.innerText = obj.type === 'light' ? '💡' : '📦';
		
		const text = document.createElement('span');
		text.innerText = obj.name + (obj.isLocked ? ' 🔒' : '');
		
		item.appendChild(icon);
		item.appendChild(text);
		
		// Click Selection Logic
		item.onclick = (e) => {
			e.stopPropagation();
			
			const allItems = Array.from(this.content.querySelectorAll('.tree-item'));
			const index = allItems.indexOf(item);
			
			if (e.shiftKey && this.lastClickedIndex !== -1) {
				// Range Selection
				const start = Math.min(this.lastClickedIndex, index);
				const end = Math.max(this.lastClickedIndex, index);
				const rangeItems = allItems.slice(start, end + 1);
				const ids = rangeItems.map(el => el.dataset.id);
				
				// Add to existing selection if Ctrl is also held, else replace?
				// Standard behavior is replace for Shift-Click range
				this.manager.selectObjectsByIds(ids);
			} else if (e.ctrlKey || e.metaKey) {
				// Toggle Selection
				this.manager.selectObject(this.manager.findMeshById(obj.id), true);
			} else {
				// Single Selection
				this.manager.selectObjectsByIds([obj.id]);
			}
			
			this.lastClickedIndex = index;
		};
		
		parentContainer.appendChild(item);
	}
	
	highlightSelection (selectedData) {
		// Clear all highlights
		const allItems = this.content.querySelectorAll('.tree-item');
		allItems.forEach(el => el.classList.remove('selected'));
		
		const allHeaders = this.content.querySelectorAll('.tree-group-header');
		allHeaders.forEach(el => el.classList.remove('selected'));
		
		if (!selectedData || selectedData.length === 0) return;
		
		const selectedIds = selectedData.map(d => d.id);
		
		// Highlight Items
		selectedIds.forEach(id => {
			const el = this.content.querySelector(`.tree-item[data-id="${id}"]`);
			if (el) el.classList.add('selected');
		});
		
		// Check Groups: If all items in a group are selected, highlight header
		this.manager.groups.forEach(group => {
			const allSelected = group.objectIds.every(id => selectedIds.includes(id));
			if (allSelected && group.objectIds.length > 0) {
				const groupEl = this.content.querySelector(`.tree-group[data-group-id="${group.id}"] .tree-group-header`);
				if (groupEl) groupEl.classList.add('selected');
			}
		});
	}
}
