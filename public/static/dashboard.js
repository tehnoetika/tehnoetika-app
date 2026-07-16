// Dashboard interakcije: upload medija, markdown preview, auto-slug.
(function () {
  'use strict';

  function uploadFile(pubId, file, statusEl) {
    statusEl.textContent = 'Učitavanje… (' + Math.round(file.size / 1024 / 1024) + ' MB)';
    var url = '/api/' + pubId + '/upload?filename=' + encodeURIComponent(file.name);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Upload nije uspio');
        statusEl.textContent = '✓ ' + file.name;
        return data;
      });
    });
  }

  // --- Editor objave ---
  var editor = document.querySelector('form.editor');
  if (editor) {
    var pubId = editor.getAttribute('data-pub-id');
    var textarea = document.getElementById('body-md');
    var statusEl = document.getElementById('upload-status');

    // Umetni tekst na trenutnu poziciju kursora, zadrži undo povijest gdje je moguće.
    function insertAtCursor(text) {
      var start = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.focus();
      if (document.execCommand) {
        // execCommand čuva native undo stack
        try {
          textarea.setSelectionRange(start, end);
          if (document.execCommand('insertText', false, text)) return;
        } catch (e) {}
      }
      textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
      var pos = start + text.length;
      textarea.setSelectionRange(pos, pos);
    }

    // --- Formatiranje: omotaj označeni tekst (bold/italic/link) ili prefiksiraj retke (h2/quote/ul) ---
    function wrapSelection(before, after, placeholder) {
      var start = textarea.selectionStart, end = textarea.selectionEnd;
      var sel = textarea.value.slice(start, end) || placeholder || '';
      var text = before + sel + after;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      if (!(document.execCommand && document.execCommand('insertText', false, text))) {
        textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
      }
      // označi umetnuti sadržaj (bez markera) radi daljnjeg tipkanja
      var innerStart = start + before.length;
      textarea.setSelectionRange(innerStart, innerStart + sel.length);
    }

    function prefixLines(prefix) {
      var start = textarea.selectionStart, end = textarea.selectionEnd;
      var val = textarea.value;
      var lineStart = val.lastIndexOf('\n', start - 1) + 1;
      var block = val.slice(lineStart, end);
      var replaced = block.split('\n').map(function (l) { return prefix + l; }).join('\n');
      textarea.focus();
      textarea.setSelectionRange(lineStart, end);
      if (!(document.execCommand && document.execCommand('insertText', false, replaced))) {
        textarea.value = val.slice(0, lineStart) + replaced + val.slice(end);
      }
    }

    function applyFmt(kind) {
      if (kind === 'bold') wrapSelection('**', '**', 'podebljano');
      else if (kind === 'italic') wrapSelection('*', '*', 'kurziv');
      else if (kind === 'link') {
        var start = textarea.selectionStart, end = textarea.selectionEnd;
        var sel = textarea.value.slice(start, end) || 'tekst';
        wrapSelection('[', '](https://)', sel === 'tekst' ? 'tekst' : null);
      }
      else if (kind === 'h2') prefixLines('## ');
      else if (kind === 'quote') prefixLines('> ');
      else if (kind === 'ul') prefixLines('- ');
    }

    var fmtBtns = editor.querySelectorAll('button.fmt');
    for (var i = 0; i < fmtBtns.length; i++) {
      (function (btn) {
        // mousedown umjesto click da textarea ne izgubi selekciju/fokus
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); applyFmt(btn.getAttribute('data-fmt')); });
      })(fmtBtns[i]);
    }

    // Tipkovni prečaci u textarei
    textarea.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); applyFmt('bold'); }
      else if (k === 'i') { e.preventDefault(); applyFmt('italic'); }
      else if (k === 'k') { e.preventDefault(); applyFmt('link'); }
    });

    // --- Upload: gumb, drag&drop i paste ---
    function handleUpload(file) {
      if (!file) return;
      uploadFile(pubId, file, statusEl)
        .then(function (data) { insertAtCursor('\n' + data.markdown + '\n'); })
        .catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
    }

    var btnUpload = document.getElementById('btn-upload');
    var fileInput = document.getElementById('file-input');
    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        handleUpload(fileInput.files[0]);
        fileInput.value = '';
      });
    }

    // Drag & drop slike/videa izravno na textareu
    ['dragover', 'dragenter'].forEach(function (ev) {
      textarea.addEventListener(ev, function (e) { e.preventDefault(); textarea.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      textarea.addEventListener(ev, function () { textarea.classList.remove('drag-over'); });
    });
    textarea.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        handleUpload(e.dataTransfer.files[0]);
      }
    });

    // Paste slike iz međuspremnika
    textarea.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var j = 0; j < items.length; j++) {
        if (items[j].type && items[j].type.indexOf('image/') === 0) {
          e.preventDefault();
          handleUpload(items[j].getAsFile());
          return;
        }
      }
    });

    var btnPreview = document.getElementById('btn-preview');
    var preview = document.getElementById('preview');
    if (btnPreview && preview) {
      btnPreview.addEventListener('click', function () {
        if (!preview.hidden) { preview.hidden = true; return; }
        fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ md: textarea.value }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            preview.innerHTML = data.html;
            preview.hidden = false;
          });
      });
    }
  }

  // --- Nova publikacija: auto-slug iz imena ---
  var pubName = document.getElementById('pub-name');
  var pubSlug = document.getElementById('pub-slug');
  if (pubName && pubSlug) {
    var slugTouched = false;
    pubSlug.addEventListener('input', function () { slugTouched = true; });
    pubName.addEventListener('input', function () {
      if (slugTouched) return;
      pubSlug.value = pubName.value
        .replace(/[đĐ]/g, 'd')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    });
  }

  // --- Postavke: upload loga ---
  var logoInput = document.getElementById('logo-input');
  var logoField = document.getElementById('logo-media-id');
  if (logoInput && logoField) {
    var form = logoInput.closest('form');
    var pid = form.getAttribute('data-pub-id');
    var st = document.getElementById('upload-status');
    logoInput.addEventListener('change', function () {
      var file = logoInput.files[0];
      if (!file) return;
      uploadFile(pid, file, st)
        .then(function (data) { logoField.value = data.id; })
        .catch(function (err) { st.textContent = '✗ ' + err.message; });
    });
  }
})();
