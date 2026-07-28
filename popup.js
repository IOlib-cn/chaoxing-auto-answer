/**
 * popup.js - 弹出窗口逻辑
 * 
 * 功能：解析用户输入的答案列表，控制填充流程的开始/停止，显示状态和进度。
 * 支持多行代码答案解析：答案可以跨多行，直到遇到下一个题号为止。
 * 默认延迟改为 800ms，确保填充过程稳定。
 * 
 * 作者：风予一下
 * 版本：v1
 */

const answerBox = document.getElementById('answerBox');
const delayBox = document.getElementById('delayBox');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const barFill = document.getElementById('barFill');
const progressText = document.getElementById('progressText');

// 恢复上次保存的答案和延迟
chrome.storage.local.get(['answers', 'delay'], (r) => {
  if (r.answers) answerBox.value = r.answers;
  if (r.delay) delayBox.value = r.delay;
});

// 自动保存
answerBox.addEventListener('input', () => {
  chrome.storage.local.set({ answers: answerBox.value });
});
delayBox.addEventListener('input', () => {
  chrome.storage.local.set({ delay: delayBox.value });
});

/**
 * 解析答案文本（支持多行代码答案）
 * 格式：每行以题号开头（数字+点/顿号/空格），答案可以跨多行，
 * 直到遇到下一个题号或文件末尾。空白行会被忽略。
 * @param {string} text - 原始答案文本
 * @returns {object} 题号到答案的映射
 */
function parseAnswers(text) {
  const map = {};
  const lines = text.split('\n');
  let currentNum = null;
  let currentAnswerLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 尝试匹配题号开头：数字 + 点/顿号/空格
    const headerMatch = line.match(/^(\d+)\s*[.、\.]\s*/);
    if (headerMatch) {
      // 如果之前有正在积累的答案，先保存
      if (currentNum !== null && currentAnswerLines.length > 0) {
        map[currentNum] = currentAnswerLines.join('\n');
      }
      // 开始新题目
      currentNum = parseInt(headerMatch[1], 10);
      const rest = line.substring(headerMatch[0].length);
      currentAnswerLines = rest ? [rest] : [];
    } else {
      // 续行：属于当前题目的答案
      if (currentNum !== null) {
        currentAnswerLines.push(line);
      }
    }
  }

  // 保存最后一题
  if (currentNum !== null && currentAnswerLines.length > 0) {
    map[currentNum] = currentAnswerLines.join('\n');
  }

  return map;
}

/** 更新状态文本 */
function setStatus(text) { statusText.textContent = '状态：' + text; }

/** 更新进度条和数字 */
function setProgress(cur, total) {
  const pct = total > 0 ? (cur / total * 100) : 0;
  barFill.style.width = pct + '%';
  progressText.textContent = cur + ' / ' + total;
}

/** 获取当前激活的标签页 */
async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** 启动时查询当前页面的注入状态 */
async function queryInjectStatus() {
  const tab = await getTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { cmd: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('未检测到试卷页面或插件未注入');
    } else if (response) {
      setStatus(response.status || '已就绪');
      if (response.totalQuestions > 0) {
        setProgress(0, response.totalQuestions);
      }
    }
  });
}

queryInjectStatus();

// 开始按钮点击事件
startBtn.addEventListener('click', async () => {
  const answers = parseAnswers(answerBox.value);
  const count = Object.keys(answers).length;
  if (count === 0) {
    alert('没解析到答案，请检查格式：每行以题号开头，多行答案连续书写');
    return;
  }
  const delay = parseInt(delayBox.value) || 800;
  const tab = await getTab();

  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus('填充中...');
  setProgress(0, count);

  chrome.tabs.sendMessage(tab.id, {
    cmd: 'start',
    answers: answers,
    delay: delay
  });
});

// 停止按钮点击事件
stopBtn.addEventListener('click', async () => {
  const tab = await getTab();
  chrome.tabs.sendMessage(tab.id, { cmd: 'stop' });
});

// 接收 content 脚本的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'init') {
    setStatus(msg.status || '已就绪');
    if (msg.totalQuestions > 0) {
      setProgress(0, msg.totalQuestions);
    }
  } else if (msg.type === 'progress') {
    setProgress(msg.done, msg.total);
  } else if (msg.type === 'done') {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus('完成 成功' + msg.success + ' 失败' + msg.fail);
    setProgress(msg.total, msg.total);
  } else if (msg.type === 'stopped') {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus('已停止');
  }
});