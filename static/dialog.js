/* Lykie 统一对话框：替代系统 alert / confirm / prompt */
(function (global) {
  'use strict';

  const STYLE_ID = 'lykie-dialog-style';
  let root = null;
  let titleEl = null;
  let bodyEl = null;
  let inputWrap = null;
  let inputEl = null;
  let actionsEl = null;
  let resolver = null;
  let mode = 'alert';

  function ensureDom() {
    if (root) return;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '#lykieDialogModal{z-index:400}' +
        '.lykie-dialog-box{max-width:400px}' +
        '.lykie-dialog-body{margin:0 0 16px;font-size:15px;line-height:1.6;color:var(--text);white-space:pre-wrap;word-break:break-word}' +
        '.lykie-dialog-input-wrap{margin:0 0 16px}' +
        '.lykie-dialog-input-wrap input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:15px;font-family:inherit;outline:none}' +
        '.lykie-dialog-input-wrap input:focus{border-color:var(--primary)}' +
        '.lykie-dialog-actions{display:flex;gap:10px;flex-wrap:wrap}' +
        '.lykie-dialog-actions .btn{flex:1 1 auto;min-width:96px}';
      document.head.appendChild(style);
    }
    root = document.createElement('div');
    root.className = 'modal';
    root.id = 'lykieDialogModal';
    root.hidden = true;
    root.innerHTML =
      '<div class="modal-box lykie-dialog-box" role="dialog" aria-modal="true" aria-labelledby="lykieDialogTitle">' +
      '<h3 id="lykieDialogTitle">提示</h3>' +
      '<div class="lykie-dialog-body" id="lykieDialogBody"></div>' +
      '<div class="lykie-dialog-input-wrap" id="lykieDialogInputWrap" hidden>' +
      '<input type="text" id="lykieDialogInput" autocomplete="off" />' +
      '</div>' +
      '<div class="modal-actions lykie-dialog-actions" id="lykieDialogActions"></div>' +
      '</div>';
    document.body.appendChild(root);
    titleEl = root.querySelector('#lykieDialogTitle');
    bodyEl = root.querySelector('#lykieDialogBody');
    inputWrap = root.querySelector('#lykieDialogInputWrap');
    inputEl = root.querySelector('#lykieDialogInput');
    actionsEl = root.querySelector('#lykieDialogActions');

    root.addEventListener('click', (e) => {
      if (e.target !== root) return;
      cancel();
    });
    document.addEventListener('keydown', (e) => {
      if (!root || root.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && mode === 'prompt' && document.activeElement === inputEl) {
        e.preventDefault();
        finish(inputEl.value);
      }
    });
  }

  function lock(on) {
    if (typeof global.setModalScrollLock === 'function') global.setModalScrollLock(!!on);
    else document.body.classList.toggle('modal-scroll-lock', !!on);
  }

  function cancel() {
    if (mode === 'alert') finish(true);
    else if (mode === 'confirm') finish(false);
    else finish(null);
  }

  function finish(value) {
    if (!root || root.hidden) return;
    root.hidden = true;
    lock(false);
    const r = resolver;
    resolver = null;
    if (r) r(value);
  }

  function open(opts) {
    ensureDom();
    if (resolver) {
      const prev = resolver;
      resolver = null;
      prev(mode === 'alert' ? true : mode === 'confirm' ? false : null);
    }
    mode = opts.mode;
    titleEl.textContent = opts.title || (mode === 'confirm' ? '请确认' : mode === 'prompt' ? '请输入' : '提示');
    bodyEl.textContent = opts.message == null ? '' : String(opts.message);
    actionsEl.innerHTML = '';
    if (mode === 'prompt') {
      inputWrap.hidden = false;
      inputEl.value = opts.defaultValue == null ? '' : String(opts.defaultValue);
      inputEl.placeholder = opts.placeholder || '';
    } else {
      inputWrap.hidden = true;
    }

    (opts.buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      if (b.primary) btn.classList.add('primary');
      else btn.classList.add('ghost');
      if (b.danger) btn.classList.add('danger');
      btn.textContent = b.label;
      btn.onclick = () => {
        if (b.getValue) finish(b.getValue());
        else finish(b.value);
      };
      actionsEl.appendChild(btn);
    });

    root.hidden = false;
    lock(true);
    if (mode === 'prompt') {
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 30);
    } else {
      const primary = actionsEl.querySelector('.btn.primary') || actionsEl.querySelector('.btn');
      if (primary) setTimeout(() => primary.focus(), 30);
    }

    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  function alert(message, opts) {
    opts = opts || {};
    return open({
      mode: 'alert',
      title: opts.title || '提示',
      message,
      buttons: [{ label: opts.okText || '知道了', value: true, primary: true }],
    });
  }

  function confirm(message, opts) {
    opts = opts || {};
    return open({
      mode: 'confirm',
      title: opts.title || '请确认',
      message,
      buttons: [
        { label: opts.cancelText || '取消', value: false },
        {
          label: opts.okText || '确定',
          value: true,
          primary: true,
          danger: !!opts.danger,
        },
      ],
    });
  }

  function prompt(message, defaultValue, opts) {
    opts = opts || {};
    return open({
      mode: 'prompt',
      title: opts.title || '请输入',
      message,
      defaultValue: defaultValue == null ? '' : defaultValue,
      placeholder: opts.placeholder || '',
      buttons: [
        { label: opts.cancelText || '取消', value: null },
        {
          label: opts.okText || '确定',
          primary: true,
          getValue: () => (inputEl ? inputEl.value : ''),
        },
      ],
    });
  }

  global.LykieDialog = {
    alert,
    confirm,
    prompt,
    close: cancel,
  };
})(window);
