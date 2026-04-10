// script.js
let chatMessages = document.getElementById('chat-messages');
let historyList = document.getElementById('history-list');

// 模拟问答数据
const mockResponses = {
    'TB/T标准检测方法': '根据TB 005-2014，检测方法包括...（来源：第10页）',
    '缺陷风险分析': '缺陷风险分析显示...（来源：TB/T 1234-2020）',
    '检测方法': '建议检测方法：...（来源：TB/T 5678-2019）'
};

function sendMessage() {
    const input = document.getElementById('user-input');
    const message = input.value.trim();
    if (!message) return;

    // 添加用户消息
    addMessage('user', message);

    // 调用后端API
    fetch('/ask', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question: message })
    })
    .then(response => response.json())
    .then(data => {
        const response = data.answer || '抱歉，未找到相关信息。';
        addMessage('bot', response);
        addToHistory(message, response);
    })
    .catch(error => {
        addMessage('bot', '错误：无法连接到服务器。');
        console.error('Error:', error);
    });

    input.value = '';
}

function addMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = sender === 'user' ? 'user-message' : 'bot-message';
    messageDiv.textContent = text;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addToHistory(question, answer) {
    const li = document.createElement('li');
    li.textContent = question;
    li.onclick = () => {
        chatMessages.innerHTML = '';
        addMessage('user', question);
        addMessage('bot', answer);
    };
    historyList.appendChild(li);
}

function quickAsk(question) {
    document.getElementById('user-input').value = question;
    // 显示提示信息
    alert('已填充问题：“' + question + '”，点击发送开始问答。');
    // 平滑滚动到问答区
    scrollToSection('chat-area');
    // sendMessage(); // 可选：自动发送
}

function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
    }
}

function viewDoc(docName) {
    // 展开说明：显示文档简介
    const details = document.getElementById('doc-details');
    if (!details) {
        const newDetails = document.createElement('div');
        newDetails.id = 'doc-details';
        newDetails.innerHTML = `<h3>${docName}</h3><p>这是${docName}的简介。基于本地知识库，后续可集成PDF查看。</p>`;
        document.querySelector('.docs-footer').appendChild(newDetails);
    } else {
        details.style.display = details.style.display === 'none' ? 'block' : 'none';
    }
}