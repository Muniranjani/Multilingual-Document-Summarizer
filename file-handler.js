// File handling functions
const fileHandler = {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    SUPPORTED_TYPES: {
        'text/plain': true,
        'application/pdf': true,
        'application/msword': true,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
        'image/jpeg': true,
        'image/png': true,
        'image/gif': true,
        'image/bmp': true,
        'image/tiff': true
    },
    fileMap: new WeakMap(),

    handleFiles(files) {
        // Process each file
        Array.from(files).forEach(file => {
            // Validate file size
            if (file.size > this.MAX_FILE_SIZE) {
                this.showError(`File ${file.name} is too large. Maximum size is ${this.formatFileSize(this.MAX_FILE_SIZE)}`);
                return;
            }
            
            // Validate file type
            if (!this.SUPPORTED_TYPES[file.type]) {
                this.showError(`File type ${file.type} is not supported for ${file.name}`);
                return;
            }
            
            this.displayFileInfo(file);
        });
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    getFileIcon(file) {
        const type = file.type.split('/')[0];
        switch (type) {
            case 'image':
                return 'fa-image';
            case 'application':
                if (file.name.endsWith('.pdf')) return 'fa-file-pdf';
                if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) return 'fa-file-word';
                return 'fa-file';
            default:
                return 'fa-file-alt';
        }
    },

    showError(message) {
        const errorContainer = document.getElementById('errorContainer');
        const error = document.createElement('div');
        error.className = 'error-message';
        error.setAttribute('role', 'alert');
        error.innerHTML = `<i class="fas fa-exclamation-circle" aria-hidden="true"></i> ${message}`;
        
        const existingError = errorContainer.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }
        
        errorContainer.appendChild(error);
        setTimeout(() => {
            error.style.opacity = '0';
            error.style.transform = 'translateY(-10px)';
            setTimeout(() => error.remove(), 300);
        }, 5000);
    },

    displayFileInfo(file) {
        const fileList = document.getElementById('fileList');
        const template = document.querySelector('.file-item.template');
        const fileItem = template.cloneNode(true);
        fileItem.classList.remove('template');
        fileItem.style.display = '';
        
        // Update file icon
        const iconElement = fileItem.querySelector('.file-icon i');
        iconElement.className = `fas ${this.getFileIcon(file)}`;
        
        // Update file details
        fileItem.querySelector('.file-name').textContent = file.name;
        fileItem.querySelector('.file-meta').textContent = this.formatFileSize(file.size);
        
    // Store file reference in WeakMap
    this.fileMap.set(fileItem, file);
    // expose the map globally so other scripts (script.js) can access uploaded files
    try { window.__fileMap = this.fileMap; window.__fileHandler = this; } catch (e) { /* ignore if not allowed */ }
        
        // Set up remove button
        const removeBtn = fileItem.querySelector('.icon-btn.remove');
        removeBtn.onclick = () => {
            fileItem.style.opacity = '0';
            setTimeout(() => {
                fileItem.remove();
                this.fileMap.delete(fileItem);
            }, 300);
        };
        
        // Initialize checkbox
        const checkbox = fileItem.querySelector('.file-select');
        if (checkbox) {
            checkbox.checked = true;
        }
        
        // Add to file list with animation
        fileItem.style.opacity = '0';
        fileList.appendChild(fileItem);
        setTimeout(() => fileItem.style.opacity = '1', 10);
    },

    initializeHandlers() {
        const dropZone = document.getElementById('dropZone');
        const fileUpload = document.getElementById('fileUpload');

        if (!dropZone || !fileUpload) {
            console.error('Required file upload elements not found');
            return;
        }

        // Drop zone event handlers
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
            dropZone.style.borderColor = 'var(--primary-color)';
            dropZone.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            dropZone.style.borderColor = 'var(--glass-border)';
            dropZone.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            dropZone.style.borderColor = 'var(--glass-border)';
            dropZone.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFiles(files);
            }
        });

        fileUpload.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                this.handleFiles(files);
            }
            // Reset input for repeated uploads of the same file
            fileUpload.value = '';
        });

        // Add click handler for the drop zone
        dropZone.addEventListener('click', () => {
            fileUpload.click();
        });
    }
};

// Initialize file handler when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    fileHandler.initializeHandlers();
});