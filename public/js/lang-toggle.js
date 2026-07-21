function setLanguage(lang) {
  document.querySelectorAll('[data-en]').forEach(el => {
    const text = lang === 'bn' ? el.getAttribute('data-bn') : el.getAttribute('data-en');
    if (text !== null) el.textContent = text;
  });
  document.documentElement.lang = lang;
  localStorage.setItem('hac-lang', lang);
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('lang-' + lang);
  if (activeBtn) activeBtn.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('hac-lang') || 'en';
  setLanguage(saved);
});
