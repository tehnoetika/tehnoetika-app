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
      else if (kind === 'strike') wrapSelection('~~', '~~', 'precrtano');
      else if (kind === 'h2') prefixLines('## ');
      else if (kind === 'h3') prefixLines('### ');
      else if (kind === 'quote') prefixLines('> ');
      else if (kind === 'pullquote') prefixLines('> [!istaknuto] ');
      else if (kind === 'ul') prefixLines('- ');
      else if (kind === 'ol') numberLines();
      else if (kind === 'hr') insertBlock('---');
      else if (kind === 'table') insertBlock('| Stupac 1 | Stupac 2 |\n|---|---|\n| … | … |');
      else if (kind === 'footnote') insertFootnote();
      textarea.dispatchEvent(new Event('input'));
    }

    function numberLines() {
      var start = textarea.selectionStart, end = textarea.selectionEnd;
      var val = textarea.value;
      var lineStart = val.lastIndexOf('\n', start - 1) + 1;
      var block = val.slice(lineStart, end);
      var n = 0;
      var replaced = block.split('\n').map(function (l) { n++; return n + '. ' + l; }).join('\n');
      textarea.focus();
      textarea.setSelectionRange(lineStart, end);
      if (!(document.execCommand && document.execCommand('insertText', false, replaced))) {
        textarea.value = val.slice(0, lineStart) + replaced + val.slice(end);
      }
    }

    // Blok u zasebnom odlomku (prazni redovi prije i poslije).
    function insertBlock(text) {
      var pos = textarea.selectionEnd, val = textarea.value;
      var before = val.slice(0, pos), after = val.slice(pos);
      var pre = before === '' || /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
      var post = /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
      textarea.setSelectionRange(pos, pos);
      insertAtCursor(pre + text + post);
    }

    // Fusnota: [^n] na kursoru + definicija na kraju teksta.
    function insertFootnote() {
      var used = textarea.value.match(/\[\^(\d+)\]/g) || [];
      var max = 0;
      used.forEach(function (u) { var k = parseInt(u.slice(2), 10); if (k > max) max = k; });
      var n = max + 1;
      insertAtCursor('[^' + n + ']');
      var val = textarea.value.replace(/\s+$/, '');
      textarea.value = val + '\n\n[^' + n + ']: tekst fusnote';
      var defStart = textarea.value.length - 'tekst fusnote'.length;
      textarea.focus();
      textarea.setSelectionRange(defStart, textarea.value.length);
      textarea.scrollTop = textarea.scrollHeight;
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
        .then(function (data) {
          if (data.kind === 'file') {
            // PDF: ponudi ga kao prilog za preuzimanje i umetni poveznicu u tekst.
            var sel = document.getElementById('attachment-select');
            if (sel) {
              var opt = document.createElement('option');
              opt.value = data.id; opt.textContent = data.filename; opt.selected = true;
              sel.appendChild(opt);
            }
          }
          insertAtCursor('\n' + data.markdown + '\n');
          textarea.dispatchEvent(new Event('input'));
        })
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

    // --- Pregled uživo (split) ---
    var btnPreview = document.getElementById('btn-preview');
    var preview = document.getElementById('preview');
    var panes = editor.querySelector('.editor-panes');
    var previewTimer = null;
    function refreshPreview() {
      if (preview.hidden) return;
      fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md: textarea.value }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) { preview.innerHTML = data.html || ''; });
    }
    if (btnPreview && preview) {
      btnPreview.addEventListener('click', function () {
        preview.hidden = !preview.hidden;
        panes.classList.toggle('split', !preview.hidden);
        btnPreview.setAttribute('aria-pressed', String(!preview.hidden));
        refreshPreview();
      });
    }

    // --- Brojač riječi + vrijeme čitanja ---
    var wc = document.getElementById('word-count');
    function updateCount() {
      var words = (textarea.value.replace(/[#>*_`\[\]()!-]/g, ' ').match(/\S+/g) || []).length;
      var min = Math.max(1, Math.round(words / 220));
      if (wc) wc.textContent = words + ' riječi · ~' + min + ' min čitanja';
    }

    // --- Automatsko spremanje skice u preglednik (svakih 20 s) ---
    // Spremamo lokalno, ne na poslužitelj: objavljeni tekst se ne mijenja dok autor ne klikne "Ažuriraj".
    var saveKey = 'tehnoetika-draft:' + pubId + ':' + editor.getAttribute('data-post-id');
    var autosaveEl = document.getElementById('autosave-status');
    var titleInput = editor.querySelector('input[name="title"]');
    var dirty = false;
    function lsGet() { try { return JSON.parse(localStorage.getItem(saveKey) || 'null'); } catch (e) { return null; } }
    function lsSet(v) { try { localStorage.setItem(saveKey, JSON.stringify(v)); return true; } catch (e) { return false; } }
    function lsDel() { try { localStorage.removeItem(saveKey); } catch (e) {} }
    var stored = lsGet();
    if (stored && stored.body !== textarea.value && autosaveEl) {
      autosaveEl.innerHTML = '';
      var restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'linklike';
      restore.textContent = 'Vrati nespremljenu verziju (' + new Date(stored.at).toLocaleString('hr-HR') + ')';
      restore.addEventListener('click', function () {
        textarea.value = stored.body;
        if (stored.title && titleInput) titleInput.value = stored.title;
        autosaveEl.textContent = 'Vraćeno — spremi skicu da potvrdiš.';
        textarea.dispatchEvent(new Event('input'));
      });
      autosaveEl.appendChild(restore);
    } else if (stored) {
      lsDel();
    }
    setInterval(function () {
      if (!dirty) return;
      dirty = false;
      if (lsSet({ body: textarea.value, title: titleInput ? titleInput.value : '', at: Date.now() }) && autosaveEl) {
        autosaveEl.textContent = 'Automatski spremljeno u preglednik u ' + new Date().toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
      }
    }, 20000);
    editor.addEventListener('submit', function () { lsDel(); });

    textarea.addEventListener('input', function () {
      dirty = true;
      updateCount();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(refreshPreview, 500);
    });
    if (titleInput) titleInput.addEventListener('input', function () { dirty = true; });
    updateCount();

    // --- Plutajuća traka na označenom tekstu (Substack model) ---
    var floatBar = document.getElementById('float-toolbar');
    // Koordinate kursora u textarei preko "mirror" diva s istim stilom.
    function caretCoords(pos) {
      var cs = getComputedStyle(textarea);
      var mirror = document.createElement('div');
      ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom',
        'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'whiteSpace', 'wordWrap', 'tabSize'].forEach(function (p) {
        mirror.style[p] = cs[p];
      });
      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.width = textarea.clientWidth + 'px';
      mirror.textContent = textarea.value.slice(0, pos);
      var mark = document.createElement('span');
      mark.textContent = '​';
      mirror.appendChild(mark);
      document.body.appendChild(mirror);
      var top = mark.offsetTop, left = mark.offsetLeft;
      document.body.removeChild(mirror);
      return { top: top - textarea.scrollTop, left: left };
    }
    function updateFloat() {
      if (!floatBar) return;
      var s0 = textarea.selectionStart, s1 = textarea.selectionEnd;
      if (s0 === s1 || document.activeElement !== textarea) { floatBar.hidden = true; return; }
      var p = caretCoords(s0);
      var host = editor.querySelector('.editor-main');
      var tr = textarea.getBoundingClientRect(), hr = host.getBoundingClientRect();
      var top = tr.top - hr.top + p.top - 44;
      var left = Math.max(0, Math.min(tr.left - hr.left + p.left, host.clientWidth - 220));
      if (p.top < 0 || p.top > textarea.clientHeight) { floatBar.hidden = true; return; }
      floatBar.style.top = top + 'px';
      floatBar.style.left = left + 'px';
      floatBar.hidden = false;
    }
    if (floatBar) {
      ['mouseup', 'keyup', 'select'].forEach(function (ev) { textarea.addEventListener(ev, function () { setTimeout(updateFloat, 0); }); });
      textarea.addEventListener('scroll', updateFloat);
      textarea.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== textarea) floatBar.hidden = true; }, 150); });
      floatBar.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault();
          applyFmt(btn.getAttribute('data-fmt'));
          setTimeout(updateFloat, 0);
        });
      });
    }

    // --- Dijalog za sliku: knjižnica ili upload, opis, poravnanje ---
    var imgDialog = document.getElementById('img-dialog');
    var btnImage = document.getElementById('btn-image');
    if (imgDialog && btnImage && imgDialog.showModal) {
      var imgUrl = document.getElementById('img-url');
      var imgInsert = document.getElementById('img-insert');
      var cursorPos = 0;
      function pick(url, btn) {
        imgUrl.value = url;
        imgInsert.disabled = false;
        imgDialog.querySelectorAll('.img-choice').forEach(function (b) { b.classList.remove('selected'); });
        if (btn) btn.classList.add('selected');
      }
      imgDialog.querySelectorAll('.img-choice[data-url]').forEach(function (b) {
        b.addEventListener('click', function () { pick(b.getAttribute('data-url'), b); });
      });
      var imgFile = document.getElementById('img-file');
      document.getElementById('img-upload-btn').addEventListener('click', function () { imgFile.click(); });
      imgFile.addEventListener('change', function () {
        var f = imgFile.files[0];
        if (!f) return;
        uploadFile(pubId, f, statusEl).then(function (data) {
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'img-choice'; b.setAttribute('data-url', data.url);
          b.innerHTML = '<img alt="" src="' + data.url + '">';
          b.addEventListener('click', function () { pick(data.url, b); });
          imgDialog.querySelector('.img-pick').insertBefore(b, imgDialog.querySelector('.img-upload'));
          pick(data.url, b);
        }).catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
        imgFile.value = '';
      });
      btnImage.addEventListener('click', function () {
        cursorPos = textarea.selectionEnd;
        imgUrl.value = ''; imgInsert.disabled = true;
        document.getElementById('img-caption').value = '';
        document.getElementById('img-alt').value = '';
        imgDialog.showModal();
      });
      // Umetanje na klik (ne na 'close' događaj — Chrome ga odgađa u neaktivnoj kartici).
      imgInsert.addEventListener('click', function () {
        if (!imgUrl.value) return;
        imgDialog.close();
        var cap = document.getElementById('img-caption').value.replace(/"/g, '”').trim();
        var alt = document.getElementById('img-alt').value.replace(/[\[\]]/g, '').trim();
        var align = (imgDialog.querySelector('input[name="img-align"]:checked') || {}).value || 'center';
        var md = '![' + alt + '](' + imgUrl.value + (cap ? ' "' + cap + '"' : '') + ')' + (align !== 'center' ? '{.' + align + '}' : '');
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
        insertBlock(md);
        textarea.dispatchEvent(new Event('input'));
      });
    }

    // --- Dijalog za video embed ---
    var videoDialog = document.getElementById('video-dialog');
    var btnVideo = document.getElementById('btn-video');
    if (videoDialog && btnVideo && videoDialog.showModal) {
      var vPos = 0;
      btnVideo.addEventListener('click', function () {
        vPos = textarea.selectionEnd;
        document.getElementById('video-url').value = '';
        videoDialog.showModal();
      });
      document.getElementById('video-url').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('video-insert').click(); }
      });
      document.getElementById('video-insert').addEventListener('click', function () {
        var u = document.getElementById('video-url').value.trim();
        if (!/^https?:\/\/\S+$/.test(u)) return;
        videoDialog.close();
        textarea.focus();
        textarea.setSelectionRange(vPos, vPos);
        insertBlock(u);
        textarea.dispatchEvent(new Event('input'));
      });
    }

    // --- Uvjetna polja po vrsti i tipu objave ---
    var kindSel = document.getElementById('kind-select');
    var typeSel = document.getElementById('type-select');
    function syncTypeFields() {
      var kind = kindSel ? kindSel.value : 'post';
      var type = typeSel ? typeSel.value : 'text';
      editor.querySelectorAll('.type-fields').forEach(function (fs) {
        var types = fs.getAttribute('data-types').split(' ');
        fs.hidden = !(kind === 'post' && types.indexOf(type) >= 0);
      });
      editor.querySelectorAll('[data-kinds]').forEach(function (el) {
        el.hidden = el.getAttribute('data-kinds') !== kind;
      });
    }
    if (kindSel) kindSel.addEventListener('change', syncTypeFields);
    if (typeSel) typeSel.addEventListener('change', syncTypeFields);
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

  // --- Mediji: upload više datoteka ---
  var mediaBox = document.querySelector('.media-upload');
  if (mediaBox) {
    var mInput = document.getElementById('media-upload-input');
    var mStatus = document.getElementById('upload-status');
    document.getElementById('media-upload-btn').addEventListener('click', function () { mInput.click(); });
    mInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(mInput.files);
      var pid = mediaBox.getAttribute('data-pub-id');
      files.reduce(function (p, f) { return p.then(function () { return uploadFile(pid, f, mStatus); }); }, Promise.resolve())
        .then(function () { location.reload(); })
        .catch(function (err) { mStatus.textContent = '✗ ' + err.message; });
    });
  }

  // --- Potvrda prije destruktivnih radnji ---
  document.querySelectorAll('button[data-confirm]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (!window.confirm(btn.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

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
