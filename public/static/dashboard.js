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

    var btnUpload = document.getElementById('btn-upload');
    var fileInput = document.getElementById('file-input');
    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        uploadFile(pubId, file, statusEl)
          .then(function (data) {
            var insert = '\n' + data.markdown + '\n';
            var pos = textarea.selectionStart || textarea.value.length;
            textarea.value = textarea.value.slice(0, pos) + insert + textarea.value.slice(pos);
          })
          .catch(function (err) { statusEl.textContent = '✗ ' + err.message; });
        fileInput.value = '';
      });
    }

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
