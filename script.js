const { createApp } = Vue;

createApp({
    data() {
        return {
            systemTitle: '铁路标准检索问答助手',
            systemSubtitle: '面向铁路标准条文检索、专业问答、缺陷与风险分析、检测方法生成的智能服务界面',
            capabilityItems: [
                '铁路标准条文与规定检索问答',
                '围绕标准要求开展缺陷与风险分析',
                '按步骤生成检测方法与执行建议',
                '支持本地标准文件上传与知识库扩展'
            ],
            quickPrompts: [
                '根据已上传标准，说明该场景是否符合规定要求',
                '请围绕某项铁路标准条文分析潜在缺陷与风险',
                '根据标准要求生成检测项目、步骤和判定依据',
                '请从标准角度总结该问题的整改建议'
            ],
            messages: [],
            userInput: '',
            isLoading: false,
            activeNav: 'home',
            abortController: null,
            sessionId: `session_${Date.now()}`,
            sessions: [],
            showHistorySidebar: false,
            isComposing: false,
            documents: [],
            documentsLoading: false,
            documentError: '',
            selectedFile: null,
            isUploading: false,
            uploadProgress: ''
        };
    },
    mounted() {
        this.configureMarked();
    },
    methods: {
        configureMarked() {
            marked.setOptions({
                highlight(code, lang) {
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                },
                langPrefix: 'hljs language-',
                breaks: true,
                gfm: true
            });
        },

        parseMarkdown(text) {
            return marked.parse(text || '');
        },

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        },

        applyPrompt(prompt) {
            this.userInput = prompt;
            this.activeNav = 'chat';
            this.showHistorySidebar = false;
            this.$nextTick(() => {
                this.autoFocusTextarea();
                this.resetTextareaHeight();
                if (this.$refs.textarea) {
                    this.$refs.textarea.style.height = 'auto';
                    this.$refs.textarea.style.height = `${this.$refs.textarea.scrollHeight}px`;
                }
            });
        },

        handleHome() {
            this.activeNav = 'home';
            this.showHistorySidebar = false;
        },

        handleChat() {
            this.activeNav = 'chat';
            this.showHistorySidebar = false;
            this.$nextTick(() => this.autoFocusTextarea());
        },

        autoFocusTextarea() {
            if (this.$refs.textarea) {
                this.$refs.textarea.focus();
            }
        },

        handleCompositionStart() {
            this.isComposing = true;
        },

        handleCompositionEnd() {
            this.isComposing = false;
        },

        handleKeyDown(event) {
            if (event.key === 'Enter' && !event.shiftKey && !this.isComposing) {
                event.preventDefault();
                this.handleSend();
            }
        },

        handleStop() {
            if (this.abortController) {
                this.abortController.abort();
            }
        },

        async handleSend() {
            const text = this.userInput.trim();
            if (!text || this.isLoading || this.isComposing) return;

            this.activeNav = 'chat';
            this.showHistorySidebar = false;

            this.messages.push({
                text,
                isUser: true
            });

            this.userInput = '';
            this.$nextTick(() => {
                this.resetTextareaHeight();
                this.scrollToBottom();
            });

            this.isLoading = true;
            this.messages.push({
                text: '',
                isUser: false,
                isThinking: true,
                ragTrace: null,
                ragSteps: []
            });
            const botMsgIdx = this.messages.length - 1;

            this.abortController = new AbortController();

            try {
                const response = await fetch('/chat/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        session_id: this.sessionId
                    }),
                    signal: this.abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    let eventEndIndex;
                    while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
                        const eventStr = buffer.slice(0, eventEndIndex);
                        buffer = buffer.slice(eventEndIndex + 2);

                        if (!eventStr.startsWith('data: ')) continue;
                        const dataStr = eventStr.slice(6);
                        if (dataStr === '[DONE]') continue;

                        try {
                            const data = JSON.parse(dataStr);
                            if (data.type === 'content') {
                                if (this.messages[botMsgIdx].isThinking) {
                                    this.messages[botMsgIdx].isThinking = false;
                                }
                                this.messages[botMsgIdx].text += data.content;
                            } else if (data.type === 'trace') {
                                this.messages[botMsgIdx].ragTrace = data.rag_trace;
                            } else if (data.type === 'rag_step') {
                                if (!this.messages[botMsgIdx].ragSteps) {
                                    this.messages[botMsgIdx].ragSteps = [];
                                }
                                this.messages[botMsgIdx].ragSteps.push(data.step);
                            } else if (data.type === 'error') {
                                this.messages[botMsgIdx].isThinking = false;
                                this.messages[botMsgIdx].text += `\n[Error: ${data.content}]`;
                            }
                        } catch (error) {
                            console.warn('SSE parse error:', error);
                        }
                    }

                    this.$nextTick(() => this.scrollToBottom());
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    this.messages[botMsgIdx].isThinking = false;
                    if (!this.messages[botMsgIdx].text) {
                        this.messages[botMsgIdx].text = '(已终止回答)';
                    } else {
                        this.messages[botMsgIdx].text += '\n\n_(回答已被终止)_';
                    }
                } else {
                    this.messages[botMsgIdx].isThinking = false;
                    this.messages[botMsgIdx].text = `系统处理失败：${error.message}`;
                }
            } finally {
                this.isLoading = false;
                this.abortController = null;
                this.$nextTick(() => this.scrollToBottom());
            }
        },

        autoResize(event) {
            const textarea = event.target;
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        },

        resetTextareaHeight() {
            if (this.$refs.textarea) {
                this.$refs.textarea.style.height = 'auto';
            }
        },

        scrollToBottom() {
            if (this.$refs.chatContainer) {
                this.$refs.chatContainer.scrollTop = this.$refs.chatContainer.scrollHeight;
            }
        },

        handleClearChat() {
            if (!confirm('确定要清空当前会话吗？')) {
                return;
            }
            this.messages = [];
            this.sessionId = `session_${Date.now()}`;
            this.activeNav = 'chat';
            this.showHistorySidebar = false;
        },

        async handleHistory() {
            this.activeNav = 'history';
            this.showHistorySidebar = true;
            try {
                const response = await fetch('/sessions');
                if (!response.ok) {
                    throw new Error('Failed to load sessions');
                }
                const data = await response.json();
                this.sessions = data.sessions;
            } catch (error) {
                alert(`加载历史记录失败：${error.message}`);
            }
        },

        async loadSession(sessionId) {
            this.sessionId = sessionId;
            this.showHistorySidebar = false;
            this.activeNav = 'chat';

            try {
                const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}`);
                if (!response.ok) {
                    throw new Error('Failed to load session messages');
                }
                const data = await response.json();
                this.messages = data.messages.map((msg) => ({
                    text: msg.content,
                    isUser: msg.type === 'human',
                    ragTrace: msg.rag_trace || null
                }));
                this.$nextTick(() => this.scrollToBottom());
            } catch (error) {
                alert(`加载会话失败：${error.message}`);
                this.messages = [];
            }
        },

        async deleteSession(sessionId) {
            if (!confirm(`确定要删除会话 "${sessionId}" 吗？`)) {
                return;
            }

            try {
                const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}`, {
                    method: 'DELETE'
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.detail || 'Delete failed');
                }

                this.sessions = this.sessions.filter((item) => item.session_id !== sessionId);

                if (this.sessionId === sessionId) {
                    this.messages = [];
                    this.sessionId = `session_${Date.now()}`;
                    this.activeNav = 'chat';
                }

                if (payload.message) {
                    alert(payload.message);
                }
            } catch (error) {
                alert(`删除会话失败：${error.message}`);
            }
        },

        handleSettings() {
            this.activeNav = 'settings';
            this.showHistorySidebar = false;
            this.documentError = '';
            this.loadDocuments();
        },

        formatDocumentError(error) {
            const message = error?.message || String(error || '');
            if (message.toLowerCase().includes('closed channel')) {
                return 'Milvus 连接已经失效，通常是向量库或后端重启后仍在使用旧连接。后端已补充自动重连逻辑；如果仍未恢复，请刷新页面或重启后端后再试。';
            }
            return message;
        },

        async loadDocuments() {
            this.documentsLoading = true;
            this.documentError = '';
            try {
                const response = await fetch('/documents');
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.detail || 'Failed to load documents');
                }
                const data = await response.json();
                this.documents = data.documents;
            } catch (error) {
                this.documents = [];
                this.documentError = this.formatDocumentError(error);
            } finally {
                this.documentsLoading = false;
            }
        },

        handleFileSelect(event) {
            const files = event.target.files;
            if (files && files.length > 0) {
                this.selectedFile = files[0];
                this.uploadProgress = '';
            }
        },

        async uploadDocument() {
            if (!this.selectedFile) {
                alert('请先选择文件');
                return;
            }

            this.isUploading = true;
            this.uploadProgress = '正在上传...';

            try {
                const formData = new FormData();
                formData.append('file', this.selectedFile);

                const response = await fetch('/documents/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.detail || 'Upload failed');
                }

                const data = await response.json();
                this.uploadProgress = data.message;
                this.documentError = '';
                this.selectedFile = null;
                if (this.$refs.fileInput) {
                    this.$refs.fileInput.value = '';
                }

                await this.loadDocuments();

                setTimeout(() => {
                    this.uploadProgress = '';
                }, 3000);
            } catch (error) {
                this.uploadProgress = `上传失败：${error.message}`;
            } finally {
                this.isUploading = false;
            }
        },

        async deleteDocument(filename) {
            if (!confirm(`确定要删除文档 "${filename}" 吗？这会同时删除向量库中的相关数据。`)) {
                return;
            }

            try {
                const response = await fetch(`/documents/${encodeURIComponent(filename)}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.detail || 'Delete failed');
                }

                const data = await response.json();
                alert(data.message);
                await this.loadDocuments();
            } catch (error) {
                alert(`删除文档失败：${error.message}`);
            }
        },

        getFileIcon(fileType) {
            if (fileType === 'PDF') return 'fas fa-file-pdf';
            if (fileType === 'Word') return 'fas fa-file-word';
            if (fileType === 'Excel') return 'fas fa-file-excel';
            return 'fas fa-file';
        }
    },
    watch: {
        messages: {
            handler() {
                this.$nextTick(() => this.scrollToBottom());
            },
            deep: true
        }
    }
}).mount('#app');
