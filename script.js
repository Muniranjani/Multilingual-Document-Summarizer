// API Configuration
const API_CONFIG = {
    BASE_URL: 'http://localhost:8000',
    ENDPOINTS: {
        UPLOAD: '/upload',
        SUMMARIZE: '/summarize',
        LANGUAGES: '/languages'
    }
};

// App state
const appState = {
    initialized: false,
    fileMap: new WeakMap()
};

function initializeApp() {
    if (appState.initialized) return;
    appState.initialized = true;

    // DOM elements with null checks
    const inputText = document.getElementById('inputText');
    const targetLanguage = document.getElementById('targetLanguage');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const outputText = document.getElementById('outputText');
    const loading = document.getElementById('loading');
    const wordCount = document.getElementById('wordCount');
    const summaryRatio = document.getElementById('summaryRatio');

    // Verify required elements exist
    if (!inputText || !targetLanguage || !summarizeBtn) {
        console.error('Required elements not found. Check if IDs are correct.');
        return;
    }
    const tabs = document.querySelectorAll('.tab-btn');
    const dropZone = document.getElementById('dropZone');
    const fileUpload = document.getElementById('fileUpload');

    // Constants
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const acceptedTypes = {
        'text/plain': true,
        'application/pdf': true,
        'application/msword': true,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
        'image/jpeg': true,
        'image/png': true,
        'image/gif': true,
        'image/bmp': true,
        'image/tiff': true
    };

    // Initialize language options
    const languages = [
        { code: 'en', name: 'English' },
        { code: 'hi', name: 'हिंदी (Hindi)' },
        { code: 'ta', name: 'தமிழ் (Tamil)' },
        { code: 'te', name: 'తెలుగు (Telugu)' },
        { code: 'kn', name: 'ಕನ್ನಡ (Kannada)' },
        { code: 'ml', name: 'മലയാളം (Malayalam)' },
        { code: 'bn', name: 'বাংলা (Bengali)' },
        { code: 'gu', name: 'ગુજરાતી (Gujarati)' },
        { code: 'mr', name: 'मराठी (Marathi)' },
        { code: 'pa', name: 'ਪੰਜਾਬੀ (Punjabi)' },
        { code: 'ur', name: 'اردو (Urdu)' },
        { code: 'sa', name: 'संस्कृतम् (Sanskrit)' }
    ];

    // Populate language select
    languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = lang.name;
        targetLanguage.appendChild(option);
    });

        // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // First, remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            tab.classList.add('active');
            
            // Hide all content sections first
            const allContent = document.querySelectorAll('.tab-content');
            allContent.forEach(content => {
                content.classList.add('hidden');
            });
            
            // Show the selected content
            const selectedTab = tab.getAttribute('data-tab');
            const targetContent = document.getElementById(selectedTab + 'Input');
            if (targetContent) {
                targetContent.classList.remove('hidden');
            }
        });
    });

    // Input validation
    function validateInput(text) {
        if (!text) {
            throw new Error('No text provided for summarization');
        }

        const trimmedText = text.trim();
        if (trimmedText.length === 0) {
            throw new Error('Please enter some text to summarize');
        }

        if (trimmedText.length < 50) {
            throw new Error('Text is too short. Please enter at least 50 characters');
        }

        if (trimmedText.length > 50000) {
            throw new Error('Text is too long. Please enter less than 50,000 characters');
        }

        return trimmedText;
    }

    // API error handling
    async function handleApiResponse(response) {
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `API Error: ${response.status}`);
        }
        return response.json();
    }

    // Utility functions
    function showError(message, container = document.getElementById('errorContainer')) {
        // Ensure we have a valid message string
        const errorMessage = typeof message === 'string' 
            ? message 
            : message instanceof Error 
                ? message.message || 'An unexpected error occurred'
                : typeof message === 'object' && message !== null
                    ? JSON.stringify(message)
                    : 'An unexpected error occurred';

        const error = document.createElement('div');
        error.className = 'error-message';
        error.setAttribute('role', 'alert');
        error.innerHTML = `<i class="fas fa-exclamation-circle" aria-hidden="true"></i> ${errorMessage}`;
        
        const existingError = container.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }
        
        if (container === dropZone.parentElement) {
            container.insertBefore(error, dropZone);
        } else {
            container.appendChild(error);
        }

        setTimeout(() => {
            error.style.opacity = '0';
            error.style.transform = 'translateY(-10px)';
            setTimeout(() => error.remove(), 300);
        }, 5000);
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function getFileIcon(file) {
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
    }

    function validateFile(file) {
        if (file.size > maxFileSize) {
            showError('File size must be less than 10MB');
            return false;
        }

        if (!acceptedTypes[file.type]) {
            showError('File type not supported');
            return false;
        }

        return true;
    }

    function updateFileStatus(fileItem, status, progress = null) {
        const statusElement = fileItem.querySelector('.file-status');
        const progressFill = fileItem.querySelector('.progress-fill');
        
        statusElement.textContent = status;
        if (progress !== null) {
            progressFill.style.width = `${progress}%`;
        }
    }

    async function uploadFile(file, fileItem) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('target_language', targetLanguage.value || 'en');
            formData.append('max_length', '150');
            formData.append('min_length', '50');

            updateFileStatus(fileItem, 'Uploading...', 30);

            const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.UPLOAD}`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || 'Upload failed');
            }

            updateFileStatus(fileItem, 'Completed', 100);
            return data;
        } catch (error) {
            console.error('Upload error:', error);
            updateFileStatus(fileItem, `Error: ${error.message}`, 0);
            throw error;
        }
    }

    // WeakMap to store file references
    const fileMap = new WeakMap();

    // helper to retrieve a File object from a file-item element
    function getFileFromItem(fileItem) {
        // try the local map first
        let f = fileMap.get(fileItem);
        if (f) return f;
        // fall back to the global file map exposed by file-handler.js
        if (window.__fileMap) {
            try { f = window.__fileMap.get(fileItem); } catch (e) { f = null; }
            if (f) return f;
        }
        return null;
    }

    function handleFiles(files) {
        const fileList = document.getElementById('fileList');
        if (!fileList) {
            console.error('File list container not found');
            return;
        }

        Array.from(files).forEach(file => {
            if (validateFile(file)) {
                const template = document.querySelector('.file-item.template');
                if (!template) {
                    console.error('File item template not found');
                    return;
                }

                const fileItem = template.cloneNode(true);
                fileItem.classList.remove('template');
                fileItem.style.display = '';

                // Update file details
                fileItem.querySelector('.file-name').textContent = file.name;
                fileItem.querySelector('.file-meta').textContent = formatFileSize(file.size);
                fileItem.querySelector('.file-icon i').className = `fas ${getFileIcon(file)}`;
                
                // Store file reference in WeakMap
                fileMap.set(fileItem, file);
                
                // Set initial status
                updateFileStatus(fileItem, 'Ready to process', 0);

                // Add to file list with animation
                fileItem.style.opacity = '0';
                fileList.appendChild(fileItem);
                setTimeout(() => fileItem.style.opacity = '1', 10);

                // Set up remove button
                const removeBtn = fileItem.querySelector('.icon-btn.remove');
                if (removeBtn) {
                    removeBtn.onclick = () => {
                        fileItem.style.opacity = '0';
                        setTimeout(() => {
                            fileItem.remove();
                            fileMap.delete(fileItem);
                        }, 300);
                    };
                }

                // Initialize checkbox
                const checkbox = fileItem.querySelector('.file-select');
                if (checkbox) {
                    checkbox.checked = true;
                }

            }
        });
    }

    // Event listeners for file handling
    // Initialize process button
    const processBtn = document.getElementById('processBtn');
    if (processBtn) {
        processBtn.addEventListener('click', async () => {
            const items = document.querySelectorAll('.file-item:not(.template)');
            const selectedItems = Array.from(items).filter(item => {
                const checkbox = item.querySelector('.file-select');
                const status = item.querySelector('.file-status');
                return checkbox?.checked && status?.textContent !== 'Completed';
            });

            if (selectedItems.length === 0) {
                showError('Please select files to process');
                return;
            }

            processBtn.disabled = true;
            let successCount = 0;

            try {
                // Process files in batches of 3
                for (let i = 0; i < selectedItems.length; i += 3) {
                    const batch = selectedItems.slice(i, i + 3);
                    await Promise.all(batch.map(async (item) => {
                        try {
                            const file = getFileFromItem(item);
                            if (!file) {
                                throw new Error('File not found');
                            }
                            await uploadFile(file, item);
                            successCount++;
                        } catch (err) {
                            console.error(`Error processing file:`, err);
                            updateFileStatus(item, `Error: ${err.message}`, 0);
                        }
                    }));
                }

                if (successCount > 0) {
                    showError(`Successfully processed ${successCount} file(s)`, document.querySelector('.processing-options'));
                }
            } catch (error) {
                console.error('Batch processing error:', error);
                showError('Error during batch processing. Some files may not have been processed.');
            } finally {
                processBtn.disabled = false;
            }
        });
    }

    // Initialize file upload handlers
    if (dropZone && fileUpload) {
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

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            dropZone.style.borderColor = 'var(--glass-border)';
            dropZone.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFiles(files);
            }
        });

        fileUpload.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                handleFiles(files);
            }
            // Reset input for repeated uploads of the same file
            fileUpload.value = '';
        });

        // Add click handler for the drop zone
        dropZone.addEventListener('click', () => {
            fileUpload.click();
        });

    // Summarization functions
    async function processFile(file, fileItem) {
        if (!file) {
            throw new Error('No file provided');
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('target_language', targetLanguage.value || 'en');
        formData.append('max_length', '150');
        formData.append('min_length', '50');
        
        if (document.getElementById('preserveFormatting')?.checked) {
            formData.append('preserve_formatting', 'true');
        }

        try {
            updateFileStatus(fileItem, 'Processing...', 50);
            
            const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.UPLOAD}`, {
                method: 'POST',
                body: formData
            });

            const data = await handleApiResponse(response);
            updateFileStatus(fileItem, 'Completed', 100);
            return data;
        } catch (error) {
            updateFileStatus(fileItem, `Error: ${error.message}`, 0);
            throw error;
        }
    }

    function updateStats(originalLength, summaryLength) {
        // If passing text instead of lengths, calculate the lengths
        if (typeof originalLength === 'string') {
            originalLength = originalLength.trim().split(/\s+/).length;
        }
        if (typeof summaryLength === 'string') {
            summaryLength = summaryLength.trim().split(/\s+/).length;
        }

        // Update word count
            if (wordCount) {
                // animate number change
                const start = parseInt(wordCount.textContent || '0', 10) || 0;
                const end = Number(originalLength);
                animateNumber(wordCount, start, end, 600);
            }

            // Update compression ratio with animation
            if (summaryRatio && originalLength > 0) {
                const ratio = Math.round((1 - summaryLength / originalLength) * 100);
                const startR = parseInt((summaryRatio.textContent || '0').replace('%',''), 10) || 0;
                animateNumber(summaryRatio, startR, ratio, 600, value => `${value}%`);
            }
    }

        // small number animator helper
        function animateNumber(el, from, to, duration = 600, formatFn) {
            const start = performance.now();
            const diff = to - from;
            const fmt = typeof formatFn === 'function' ? formatFn : v => v;
            function step(now) {
                const t = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                const current = Math.round(from + diff * eased);
                el.textContent = fmt(current);
                if (t < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
        }

    async function summarizeText(text, selectedLanguage) {
        const formData = new FormData();
        formData.append('text', text);
        formData.append('target_language', selectedLanguage);
        formData.append('max_length', 150);
        formData.append('min_length', 50);
        
        if (document.getElementById('preserveFormatting')?.checked) {
            formData.append('preserve_formatting', 'true');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SUMMARIZE}`, {
            method: 'POST',
            body: formData
        });

        return handleApiResponse(response);
    }

    // Main summarize button handler
    summarizeBtn.addEventListener('click', async function() {
        const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
        const selectedLanguage = targetLanguage.value;
        
        if (!selectedLanguage) {
            showError('Please select a target language');
            return;
        }

        if (activeTab === 'text' && !inputText.value.trim()) {
            showError('Please enter some text to summarize');
            return;
        }

        try {
            loading.classList.remove('hidden');
            summarizeBtn.disabled = true;
            outputText.innerHTML = ''; // Clear previous output

            if (activeTab === 'text') {
                // Handle text input summarization
                const text = validateInput(inputText.value);
                if (!text || text.trim().length === 0) {
                    throw new Error('Please enter valid text to summarize');
                }

                const requestData = {
                    text: text,
                    target_language: selectedLanguage || 'en',
                    max_length: 150,
                    min_length: 50,
                    preserve_formatting: document.getElementById('preserveFormatting')?.checked || false
                };

                const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SUMMARIZE}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });

                const data = await response.json();
                if (!response.ok) {
                    let errorMessage;
                    if (response.status === 422) {
                        // Handle validation errors
                        errorMessage = data.detail 
                            ? Array.isArray(data.detail) 
                                ? data.detail.map(err => err.msg).join(', ')
                                : data.detail
                            : 'Invalid input data. Please check your input and try again.';
                    } else {
                        errorMessage = data.detail || `Server error! Status: ${response.status}`;
                    }
                    throw new Error(errorMessage);
                }

                if (!data.summary) {
                    throw new Error('No summary was generated. Please try again.');
                }

                // show summary with reveal animation
                outputText.innerHTML = `<div class="summary-content">${data.summary}</div>`;
                outputText.classList.add('revealed');
                if (data.original_length && data.summary_length) {
                    updateStats(data.original_length, data.summary_length);
                } else {
                    updateStats(inputText.value.length, data.summary.length);
                }
            } else {
                // Handle file summarization
                const fileItems = Array.from(document.querySelectorAll('.file-item:not(.template)'));
                if (fileItems.length === 0) {
                    showError('Please upload at least one file to summarize');
                    return;
                }

                const processBatch = document.getElementById('processInBatch')?.checked;
                const maxConcurrent = 3; // Maximum number of concurrent file uploads
                
                if (processBatch) {
                    // Process files in batches to avoid overwhelming the server
                    const results = [];
                    for (let i = 0; i < fileItems.length; i += maxConcurrent) {
                        const batch = fileItems.slice(i, i + maxConcurrent);
                        const promises = batch.map(async (fileItem) => {
                            const file = fileMap.get(fileItem);
                            if (!file) {
                                updateFileStatus(fileItem, 'Error: No file found', 0);
                                throw new Error('No file found');
                            }
                            
                            return await processFile(file, fileItem);
                        });

                        const batchResults = await Promise.allSettled(promises);
                        results.push(...batchResults);
                    }

                    const successfulResults = results
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value);

                    if (successfulResults.length === 0) {
                        throw new Error('No files were successfully processed');
                    }

                    // Combine all summaries
                    const combinedSummary = successfulResults
                        .map(result => `<div class="summary-item">
                            <h3><i class="fas fa-file-alt"></i> ${result.filename}</h3>
                            <div class="summary-content">${result.summary}</div>
                        </div>`)
                        .join('<hr>');
                    outputText.innerHTML = combinedSummary;
                } else {
                    // Process files one by one
                    const summaries = [];
                    for (const fileItem of fileItems) {
                            const file = getFileFromItem(fileItem);
                        if (!file) {
                            updateFileStatus(fileItem, 'Error: No file found', 0);
                            continue;
                        }
                        
                        try {
                            const result = await processFile(file, fileItem);
                            summaries.push({ filename: file.name, summary: result.summary });
                        } catch (error) {
                            console.error('Error processing file:', error);
                        }
                    }

                    if (summaries.length === 0) {
                        throw new Error('No files were successfully processed');
                    }

                    const combinedSummary = summaries
                        .map(result => `<div class="summary-item">
                            <h3><i class="fas fa-file-alt"></i> ${result.filename}</h3>
                            <div class="summary-content">${result.summary}</div>
                        </div>`)
                        .join('<hr>');
                    outputText.innerHTML = combinedSummary;
                }
            }
        } catch (error) {
            console.error('Error:', error);
            const errorMessage = error.message && typeof error.message === 'string' 
                ? error.message 
                : error.detail && typeof error.detail === 'string'
                    ? error.detail
                    : 'An error occurred while processing your request';
            showError(errorMessage);
        } finally {
            loading.classList.add('hidden');
            summarizeBtn.disabled = false;
        }
    });
}

    // Initialize copy button
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const outputText = document.getElementById('outputText');
            if (outputText && outputText.textContent) {
                navigator.clipboard.writeText(outputText.textContent)
                    .then(() => {
                        showError('Summary copied to clipboard!', document.querySelector('.output-header'));
                    })
                    .catch(err => {
                        console.error('Failed to copy text:', err);
                        showError('Failed to copy text to clipboard');
                    });
            }
        });
    }

    // Initialize download button
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const outputText = document.getElementById('outputText');
            if (outputText && outputText.textContent) {
                const blob = new Blob([outputText.textContent], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'summary.txt';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        });
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        initializeApp();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        const errorContainer = document.getElementById('errorContainer');
        if (errorContainer) {
            const error = document.createElement('div');
            error.className = 'error-message';
            error.setAttribute('role', 'alert');
            error.innerHTML = '<i class="fas fa-exclamation-circle"></i> Failed to initialize application. Please refresh the page.';
            errorContainer.appendChild(error);
        }
    }
});

// Clean up on page unload
window.addEventListener('unload', () => {
    // Clean up any file references
    const fileItems = document.querySelectorAll('.file-item:not(.template)');
    fileItems.forEach(item => {
        appState.fileMap.delete(item);
    });
});