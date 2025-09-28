// Active nav & footer year
(function() {
  const page = document.documentElement.getAttribute('data-page') || document.body.getAttribute('data-page');
  document.querySelectorAll('.nav a').forEach(a => {
    if (a.dataset.page === page) a.classList.add('active');
  });
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();

  // Banner dialog
  const dialog = document.getElementById('banner-dialog');
  const openBtn = document.querySelector('.banner-btn');
  if (openBtn && dialog) {
    openBtn.addEventListener('click', () => dialog.showModal());

    dialog.addEventListener('click', (e) => {
      // click outside to close
      const rect = dialog.querySelector('.dialog-card')?.getBoundingClientRect();
      if (!rect) return;
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        dialog.close();
      }
    });

    dialog.querySelectorAll('.preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.banner;
        applyTheme(theme);
        saveTheme({ type: 'preset', value: theme });
      });
    });

    const applyCustom = dialog.querySelector('#apply-custom');
    const resetBtn = dialog.querySelector('#reset-banner');
    const input = dialog.querySelector('#banner-url');

    applyCustom?.addEventListener('click', () => {
      const url = input.value.trim();
      if (!url) return;
      document.body.classList.remove('theme-nebula','theme-waves','theme-grid');
      document.body.classList.add('theme-custom');
      document.documentElement.style.setProperty('--banner-image', `url("${url}")`);
      saveTheme({ type: 'custom', value: url });
    });

    resetBtn?.addEventListener('click', () => {
      document.body.classList.remove('theme-waves','theme-grid','theme-custom');
      document.body.classList.add('theme-nebula');
      document.documentElement.style.setProperty('--banner-image', '');
      saveTheme({ type: 'preset', value: 'nebula' });
    });
  }

  // Persist theme across pages
  function saveTheme(obj) {
    try { localStorage.setItem('bannerTheme', JSON.stringify(obj)); } catch {}
  }
  function loadTheme() {
    try {
      const raw = localStorage.getItem('bannerTheme');
      if (!raw) { document.body.classList.add('theme-nebula'); return; }
      const data = JSON.parse(raw);
      if (data.type === 'preset') applyTheme(data.value);
      if (data.type === 'custom' && data.value) {
        document.body.classList.add('theme-custom');
        document.documentElement.style.setProperty('--banner-image', `url("${data.value}")`);
      }
    } catch { document.body.classList.add('theme-nebula'); }
  }
  function applyTheme(name) {
    document.body.classList.remove('theme-nebula','theme-waves','theme-grid','theme-custom');
    if (name === 'nebula') document.body.classList.add('theme-nebula');
    if (name === 'waves') document.body.classList.add('theme-waves');
    if (name === 'grid') document.body.classList.add('theme-grid');
  }
  loadTheme();

  // Simple form validation showcase
  const form = document.querySelector('form');
  form?.addEventListener('submit', (e) => {
    let ok = true;
    form.querySelectorAll('[required]').forEach(el => {
      if (!el.value) {
        ok = false;
        const small = el.closest('.field')?.querySelector('small.error');
        if (small) small.style.display = 'block';
        el.addEventListener('input', () => { if (small) small.style.display = 'none'; }, { once: true });
      }
    });
    if (!ok) e.preventDefault();
  });
})();
