/**
 * inject.js - 解除 UEditor 粘贴限制
 * 
 * 功能：由 content.js 通过 chrome.runtime.getURL 注入到页面上下文中执行。
 * 遍历所有 UEditor 实例，移除 beforepaste 事件监听，从而允许粘贴操作。
 * 仅在需要解除粘贴限制时使用（默认不启用）。
 * 
 * 作者：风予一下
 * 版本：v1
 */
(function() {
  if (typeof UE !== 'undefined' && UE.instants) {
    for (var key in UE.instants) {
      var editor = UE.instants[key];
      if (editor && editor.removeListener) {
        editor.removeListener('beforepaste', editorPaste);
      }
    }
  }
})();