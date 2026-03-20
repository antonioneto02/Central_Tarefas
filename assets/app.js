// ============================================================
// Central de Tarefas — app.js
// Utilitários globais do frontend
// ============================================================

// ----- Toast notifications -----
function showToast(message, type) {
  type = type || 'info';
  const existing = document.querySelectorAll('.ct-toast');
  existing.forEach(function(el) { el.remove(); });

  const toast = document.createElement('div');
  toast.className = 'ct-toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 400);
  }, 3000);
}

// ----- Date helpers -----
function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatDateBR(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleDateString('pt-BR');
}

function isOverdue(isoDate) {
  if (!isoDate) return false;
  var today = new Date(); today.setHours(0,0,0,0);
  var due   = new Date(isoDate); due.setHours(0,0,0,0);
  return due < today;
}

// ----- Fetch helper -----
function apiFetch(url, opts) {
  opts = opts || {};
  opts.credentials = 'same-origin';
  opts.headers = opts.headers || {};
  if (!opts.headers['Content-Type'] && opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(url, opts).then(function(r) {
    if (r.status === 401 || r.status === 403) {
      window.location.href = '/loginPage?error=session_expired';
      return Promise.reject(new Error('Sessão expirada'));
    }
    return r.json();
  });
}
