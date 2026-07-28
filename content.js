/**
 * content.js - 试卷自动填答器核心脚本
 * 
 * 功能：自动填充学习通试卷中的单选题、多选题、判断题、填空题、简答题、编程大题等。
 * 支持题型识别：通过 h3.mark_name.colorDeep 内的 span.colorShallow 文本判断。
 * 填空题/简答题采用模拟真人操作：选中输入框 → 发送文字 → 点击保存按钮。
 * 所有富文本填充后均等待保存请求完成，确保答案持久化。
 * 
 * 本浏览器插件的开发者在B站的号：风予一下（能三连支持一下吗，我其实不喜欢做视频的当up的，但是还是想宣传一波这个东西，为大学生们留下宗门传承）
 * 版本：v1
 * 理论上，修改解析和模拟点击的元素的话，就针对其他网课平台的卷子了（如果你可以打开开发者选项看到每道题的代码的话），自己分析一波题目的代码结构体，想好提示词，让AI来重新写解析题目代码和模拟点击按钮的逻辑，由于我没有其他网课平台，所以没去搞，其他网课平台的同学如果有类似的需求的话，可以让AI二改 
 * 其实我知道现在很多Agent已经有了操控浏览器的能力，但是怎么说呢，一言难尽。我试过让Tabbit浏览器自动答题，也是像此插件一样告诉答案让它自己选，它填得慢的死，好迟钝，而且根本无法正常答完100多道题目，只能说AI控制浏览器自动化的路还是任重道远的。我之前也搜过GitHub中的一些自动答题考试的项目，这里就不列出来了，它们说到底还是要接入APIkey让AI作答，这个花费就有的不值了。大学搜题酱开vip或者搞vip限免权益也可以自动答题。doge
 * 我有空会开源到GitHub的，开源协议是MIT，禁止倒卖盈利，盗狗不得好死！
 */

let stopFlag = false;

/**
 * 收集页面中所有题目信息
 * 遍历所有 h3.mark_name.colorDeep 元素，提取题号、题目ID、题型、空白容器等信息。
 * @returns {Map<number, object>} 键为题号，值为包含 wrap, qid, type, h3, blanks 的对象
 */
function collectQuestions() {
  const map = new Map();
  const h3List = document.querySelectorAll('h3.mark_name.colorDeep');
  
  for (const h3 of h3List) {
    const text = h3.textContent.trim();
    const numMatch = text.match(/^(\d+)\s*[.、\.]/);
    if (!numMatch) continue;
    const qNum = parseInt(numMatch[1], 10);
    
    const wrap = h3.closest('.questionLi') || h3.closest('[id^="sigleQuestionDiv_"]');
    if (!wrap) continue;
    
    const qidInput = wrap.querySelector('input[name="questionId"]');
    const qid = qidInput ? qidInput.value : null;
    
    let type = 'single';
    const typeSpan = h3.querySelector('.colorShallow');
    if (typeSpan) {
      const t = typeSpan.textContent;
      if (t.includes('多选')) type = 'multi';
      else if (t.includes('判断')) type = 'judge';
      else if (t.includes('填空')) type = 'fill';
      else if (t.includes('简答') || t.includes('翻译') || t.includes('论述') || t.includes('问答') || t.includes('主观')) type = 'essay';
      else if (t.includes('编程') || t.includes('程序') || t.includes('分析') || t.includes('阅读')) type = 'essay';
    }
    
    // 收集所有子空（填空可能有多个空，essay一般只有一个）
    let blanks = [];
    if (type === 'fill' || type === 'essay') {
      const blankDivs = wrap.querySelectorAll('.sub_que_div');
      blankDivs.forEach(div => {
        const dataid = div.getAttribute('dataid');
        let saveBtn = div.querySelector('.saveButtonClass');
        if (!saveBtn) {
          saveBtn = document.querySelector(`#save_${dataid}`);
        }
        blanks.push({
          container: div,
          dataid: dataid,
          saveBtn: saveBtn
        });
      });
    }
    
    map.set(qNum, { wrap, qid, type, h3, blanks });
  }
  return map;
}

// ---------- 填空题填充（定位div元素结构层级，解除iframe标签页中UEditor编辑器的粘贴限制，如果一个填空题有多个空，需要用英文的逗号，隔开答案） ----------

/**
 * 填充单个空白（填空题专用）
 * 通过 dataid 定位到 sub_que_div，在其内部 iframe 中模拟点击和输入，最后点击保存按钮。
 * @param {string} questionId - 题目ID（如 "885087904"）
 * @param {number} blankIndex - 空序号（从1开始）
 * @param {string} answer - 要填入的答案文本
 * @returns {Promise<boolean>} 是否成功
 */
async function fillSingleBlank(questionId, blankIndex, answer) {
  const dataid = `${questionId}${blankIndex}`;
  
  const blankDiv = document.querySelector(`.sub_que_div[dataid="${dataid}"]`);
  if (!blankDiv) {
    console.warn(`[填空] 找不到 sub_que_div for dataid=${dataid}`);
    return false;
  }
  
  const iframe = blankDiv.querySelector('iframe');
  if (!iframe) {
    console.warn(`[填空] 找不到 iframe inside sub_que_div for ${dataid}`);
    return false;
  }
  
  const iframeWin = iframe.contentWindow;
  const iframeDoc = iframeWin.document;
  const body = iframeDoc.body;
  if (!body) {
    console.warn(`[填空] iframe body 不可用`);
    return false;
  }

  // 模拟点击聚焦
  body.focus();
  body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  body.dispatchEvent(new Event('focus', { bubbles: true }));
  await sleep(200);

  // 插入文本
  if (iframeDoc.queryCommandSupported('insertText')) {
    iframeDoc.execCommand('insertText', false, answer);
  } else {
    body.innerHTML = `<p>${answer}</p>`;
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(100);

  // 点击保存按钮
  const saveBtn = document.querySelector(`#save_${questionId}${blankIndex}`);
  if (saveBtn) {
    saveBtn.click();
    console.log(`[填空] 已保存空 ${blankIndex}: ${answer}`);
    await sleep(500);
    return true;
  } else {
    console.warn(`[填空] 找不到保存按钮 #save_${questionId}${blankIndex}`);
    return false;
  }
}

/**
 * 填充一道填空题的所有空
 * 遍历 blanks 数组，依次调用 fillSingleBlank。
 * @param {object} qInfo - 题目信息对象
 * @param {string[]} answersArray - 答案数组，顺序对应各个空
 * @returns {Promise<boolean>} 是否至少有一个空成功
 */
async function fillFillInBlank(qInfo, answersArray) {
  const { qid, blanks } = qInfo;
  if (!blanks || blanks.length === 0) return false;

  let successCount = 0;
  for (let i = 0; i < blanks.length; i++) {
    if (stopFlag) break;
    const answer = answersArray[i];
    if (!answer) continue;
    const ok = await fillSingleBlank(qid, i + 1, answer);
    if (ok) successCount++;
    await sleep(300);
  }
  return successCount > 0;
}

// ---------- 简答题（填空题填充（定位div元素结构层级，解除iframe标签页中UEditor编辑器的粘贴限制） /编程题填充（注意到题目代码片段与简答题，但是无法正常破解，发现只有edui编号不同，于是强行遍历编号来强制选中填空框，然后像简答题一样正常填充文字，针对编程题的代码缩进问题，优化了多行解析答案的能力） ----------

/**
 * 填充一道简答题或编程题（单空，答案整体填入）
 * 定位到 sub_que_div，在 iframe 中模拟点击和输入，最后点击保存按钮。
 * @param {object} qInfo - 题目信息对象
 * @param {string} answer - 答案文本（可能包含多行代码）
 * @returns {Promise<boolean>} 是否成功
 */
async function fillEssay(qInfo, answer) {
  const { qid, blanks } = qInfo;
  if (!blanks || blanks.length === 0) return false;

  const blank = blanks[0];
  const dataid = blank.dataid;
  const saveBtn = blank.saveBtn;
  const answerText = Array.isArray(answer) ? answer.join('\n') : answer;

  const blankDiv = document.querySelector(`.sub_que_div[dataid="${dataid}"]`);
  if (!blankDiv) {
    console.warn(`[简答] 找不到 sub_que_div for dataid=${dataid}`);
    return false;
  }
  
  const iframe = blankDiv.querySelector('iframe');
  if (!iframe) {
    console.warn(`[简答] 找不到 iframe inside sub_que_div for ${dataid}`);
    return false;
  }
  
  const iframeWin = iframe.contentWindow;
  const iframeDoc = iframeWin.document;
  const body = iframeDoc.body;
  if (!body) {
    console.warn(`[简答] iframe body 不可用`);
    return false;
  }

  // 模拟点击聚焦
  body.focus();
  body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  body.dispatchEvent(new Event('focus', { bubbles: true }));
  await sleep(200);

  // 插入文本
  if (iframeDoc.queryCommandSupported('insertText')) {
    iframeDoc.execCommand('insertText', false, answerText);
  } else {
    body.innerHTML = `<p>${answerText}</p>`;
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(100);

  // 点击保存按钮
  if (saveBtn) {
    saveBtn.click();
    console.log(`[简答] 已保存 dataid=${dataid}`);
    await sleep(500);
    return true;
  } else {
    console.warn(`[简答] 找不到保存按钮 for dataid=${dataid}`);
    return false;
  }
}

// ---------- 选择题/判断题 ----------

/**
 * 根据字母找到对应选项的 div（.answerBg）
 * @param {object} qInfo - 题目信息
 * @param {string} letter - 选项字母（A/B/C/D 或 true/false 用于判断）
 * @returns {HTMLElement|null}
 */
function findOptionEl(qInfo, letter) {
  const { wrap, type } = qInfo;
  const optDivs = wrap.querySelectorAll('.stem_answer .answerBg');
  for (const div of optDivs) {
    const span = div.querySelector('span[data]');
    if (!span) continue;
    if (type === 'judge') {
      const dataVal = span.getAttribute('data');
      if (letter === 'A' && dataVal === 'true') return div;
      if (letter === 'B' && dataVal === 'false') return div;
    } else {
      const dataVal = span.getAttribute('data').toUpperCase();
      if (dataVal === letter) return div;
    }
  }
  return null;
}

/**
 * 触发点击事件（优先调用 onclick 属性）
 * @param {HTMLElement} element - 要点击的元素
 * @returns {boolean} 是否成功触发了 onclick
 */
function triggerClick(element) {
  if (typeof element.onclick === 'function') {
    element.onclick.call(element);
    return true;
  } else {
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    return false;
  }
}

/**
 * 验证答案是否已被页面接受（检查选项的 check_answer 类）
 * @param {object} qInfo - 题目信息
 * @param {string} expectedAnswer - 期望的答案字符串（如 "ABC"）
 * @returns {boolean}
 */
function verifyAnswer(qInfo, expectedAnswer) {
  const letters = expectedAnswer.split('');
  for (const letter of letters) {
    const el = findOptionEl(qInfo, letter);
    if (!el) return false;
    const span = el.querySelector('span[data]');
    if (!span || !span.classList.contains('check_answer')) return false;
  }
  return true;
}

/**
 * 填充一道选择题或判断题
 * @param {object} qInfo - 题目信息
 * @param {string} answer - 答案（如 "A"、"BC"、"true"）
 * @returns {Promise<boolean>}
 */
async function fillChoice(qInfo, answer) {
  const { wrap, qid, type } = qInfo;
  const letters = answer.split('');
  let okCount = 0;
  for (const letter of letters) {
    const el = findOptionEl(qInfo, letter.toUpperCase());
    if (el) { triggerClick(el); okCount++; await sleep(150); }
  }
  await sleep(200);
  if (okCount > 0 && !verifyAnswer(qInfo, answer)) {
    console.warn(`[自动填答] 题号 ${qid} 页面未接受，尝试手动写入`);
    if (type === 'multi') {
      const input = wrap.querySelector(`#answers${qid}`);
      if (input) input.value = answer;
      localStorage.setItem(`ans_${qid}`, answer);
    } else {
      const input = wrap.querySelector(`#answer${qid}`);
      if (input) input.value = letters[0];
      localStorage.setItem(`ans_${qid}`, letters[0]);
    }
    if (verifyAnswer(qInfo, answer)) { console.log(`[自动填答] 手动补救成功`); return true; }
    return false;
  }
  return okCount > 0;
}

/**
 * 延时函数
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 统一填充入口 ----------

/**
 * 填充一道题（根据类型分发到对应处理函数）
 * @param {object} qInfo - 题目信息
 * @param {string} answer - 答案文本
 * @returns {Promise<boolean>}
 */
async function fillOne(qInfo, answer) {
  const { type } = qInfo;
  if (type === 'fill') {
    const arr = answer.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    return await fillFillInBlank(qInfo, arr);
  } else if (type === 'essay') {
    return await fillEssay(qInfo, answer);
  } else {
    return await fillChoice(qInfo, answer);
  }
}

// ---------- 主流程 ----------

/**
 * 主流程：依次填充所有题目
 * @param {object} answers - 题号到答案的映射
 * @param {number} delay - 每题之间的延迟（毫秒）
 */
async function runFill(answers, delay) {
  stopFlag = false;
  const questions = collectQuestions();
  const nums = Object.keys(answers).map(Number).sort((a, b) => a - b);
  const total = nums.length;
  let done = 0, success = 0, fail = 0;
  console.log(`[自动填答] 找到 ${questions.size} 道题目，准备填充 ${total} 道`);
  for (const num of nums) {
    if (stopFlag) break;
    done++;
    chrome.runtime.sendMessage({ type: 'progress', done, total });
    const qInfo = questions.get(num);
    if (!qInfo) { fail++; continue; }
    const ok = await fillOne(qInfo, answers[num]);
    if (ok) success++; else fail++;
    if (done < total && !stopFlag) await sleep(delay);
  }
  if (stopFlag) chrome.runtime.sendMessage({ type: 'stopped' });
  else chrome.runtime.sendMessage({ type: 'done', success, fail, total });
}

// 消息监听
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.cmd === 'start') { runFill(msg.answers, msg.delay || 800); sendResponse({ ok: true }); }
  else if (msg.cmd === 'stop') { stopFlag = true; sendResponse({ ok: true }); }
  else if (msg.cmd === 'getStatus') {
    const questions = collectQuestions();
    sendResponse({ status: `已就绪，找到 ${questions.size} 道题目`, totalQuestions: questions.size });
    return true;
  }
  return true;
});

// 初始化通知
(function initNotify() {
  const questions = collectQuestions();
  chrome.runtime.sendMessage({
    type: 'init',
    status: `已就绪，找到 ${questions.size} 道题目`,
    totalQuestions: questions.size
  }).catch(() => {});
})();

console.log('试卷自动填答器已加载（究极版）');